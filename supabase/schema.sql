-- =====================================================================
-- 선생님 이력서 소개팅 · Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전하도록 작성했습니다.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------

-- 이력서 (공개될 수 있는 정보만)
create table if not exists public.resumes (
  id                 uuid primary key,
  created_at         timestamptz not null default now(),
  status             text not null default '검토 대기'
                     check (status in ('검토 대기', '공개', '비공개', '매칭 완료')),
  nickname           text not null check (char_length(nickname) between 1 and 30),
  intro              text not null check (char_length(intro) between 1 and 100),
  gender             text not null check (gender in ('여성', '남성')),
  age                int  not null check (age between 19 and 80),
  height             int  check (height between 120 and 230),
  region             text not null,
  district           text,
  job                text check (char_length(job) <= 60),
  mbti               text,
  photo_path         text not null,
  extra_photo_paths  text[] not null default '{}',
  weekend            text check (char_length(weekend) <= 1000),
  keywords           text[] not null default '{}',
  good_match         text not null check (char_length(good_match) between 1 and 1000),
  bad_match          text not null check (char_length(bad_match) between 1 and 1000),
  admin_note         text
);

-- 추가 항목 (기존 테이블에도 안전하게 붙도록 따로 둬요)
alter table public.resumes add column if not exists meet_regions text[] not null default '{}';
alter table public.resumes add column if not exists pref_age_min int;
alter table public.resumes add column if not exists pref_age_max int;
alter table public.resumes add column if not exists birth_date date;
alter table public.resumes drop constraint if exists resumes_meet_regions_check;
alter table public.resumes add constraint resumes_meet_regions_check
  check (meet_regions <@ array['서울','경기','인천','강원','충청','전라','경상','제주']::text[]);
alter table public.resumes drop constraint if exists resumes_pref_age_check;
alter table public.resumes add constraint resumes_pref_age_check
  check ((pref_age_min is null or pref_age_min between 19 and 80)
     and (pref_age_max is null or pref_age_max between 19 and 80)
     and (pref_age_min is null or pref_age_max is null or pref_age_min <= pref_age_max));

-- 연락처 (운영자만 열람, 이력서와 1:1)
create table if not exists public.contacts (
  resume_id       uuid primary key references public.resumes(id) on delete cascade,
  created_at      timestamptz not null default now(),
  contact         text not null check (char_length(contact) between 2 and 60),
  email           text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  is_adult        boolean not null check (is_adult),
  privacy_agreed  boolean not null check (privacy_agreed),
  rules_agreed    boolean not null default false,
  -- 보관 기한: 기본 수집일로부터 6개월 (README의 "보관 기간" 참고)
  delete_after    date not null default ((now() + interval '6 months')::date)
);

alter table public.contacts add column if not exists rules_agreed boolean not null default false;

-- 피드백
create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  kind        text check (kind in ('좋았어요', '불편했어요', '제안해요', '기타')),
  body        text not null check (char_length(body) between 1 and 2000),
  handled     text not null default '확인 전' check (handled in ('확인 전', '확인함', '반영 완료'))
);

-- 관리자 명단 (여기에 들어간 이메일만 관리자 화면을 쓸 수 있어요)
create table if not exists public.admins (
  email text primary key
);

-- ---------------------------------------------------------------------
-- 2. 관리자 판별 함수
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------------------------------------------------------------------
-- 3. 행 단위 보안 (RLS)
--    방문자(anon)는 테이블을 직접 읽거나 쓸 수 없고,
--    아래 4번의 제출 함수를 통해서만 저장할 수 있어요.
-- ---------------------------------------------------------------------
alter table public.resumes  enable row level security;
alter table public.contacts enable row level security;
alter table public.feedback enable row level security;
alter table public.admins   enable row level security;

drop policy if exists "admin all resumes"  on public.resumes;
drop policy if exists "admin all contacts" on public.contacts;
drop policy if exists "admin all feedback" on public.feedback;
drop policy if exists "admin read admins"  on public.admins;

create policy "admin all resumes"  on public.resumes  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all contacts" on public.contacts for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin all feedback" on public.feedback for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin read admins"  on public.admins   for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- 4. 제출 함수 (이력서 + 연락처를 한 번에, 둘 다 저장되거나 둘 다 안 되거나)
-- ---------------------------------------------------------------------
create or replace function public.submit_application(p_resume jsonb, p_contact jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id        uuid := (p_resume ->> 'id')::uuid;
  v_region    text := p_resume ->> 'region';
  v_district  text := nullif(p_resume ->> 'district', '');
  v_photo     text := p_resume ->> 'photo_path';
  v_extras    text[] := coalesce(array(select jsonb_array_elements_text(p_resume -> 'extra_photo_paths')), '{}');
  v_meet      text[] := coalesce(array(select distinct jsonb_array_elements_text(coalesce(p_resume -> 'meet_regions', '[]'::jsonb))), '{}');
  v_age_min   int := nullif(p_resume ->> 'pref_age_min', '')::int;
  v_age_max   int := nullif(p_resume ->> 'pref_age_max', '')::int;
  v_birth     date := nullif(p_resume ->> 'birth_date', '')::date;
  v_age       int;
  v_path      text;
begin
  if v_id is null then
    raise exception '이력서 번호가 없어요.';
  end if;

  -- 생년월일이 있으면 서버에서 만 나이를 다시 계산해요 (한국 시간 기준)
  if v_birth is not null then
    v_age := extract(year from age((now() at time zone 'Asia/Seoul')::date, v_birth))::int;
  else
    v_age := (p_resume ->> 'age')::int;
  end if;
  if v_age is null or v_age < 19 then
    raise exception '만 19세 이상만 참여할 수 있어요.';
  end if;
  if v_age > 80 then
    raise exception '생년월일을 다시 확인해 주세요.';
  end if;

  if v_region not in ('서울', '경기', '인천', '강원', '충청', '전라', '경상', '제주') then
    raise exception '사는 지역을 다시 선택해 주세요.';
  end if;

  if v_region = '서울' and (v_district is null or v_district not in (
      '강남구','강동구','강북구','강서구','관악구','광진구','구로구','금천구','노원구','도봉구',
      '동대문구','동작구','마포구','서대문구','서초구','성동구','성북구','송파구','양천구','영등포구',
      '용산구','은평구','종로구','중구','중랑구')) then
    raise exception '서울은 사는 구를 선택해 주세요.';
  end if;

  if v_region = '경기' and (v_district is null or v_district not in (
      '수원시','성남시','고양시','용인시','부천시','안산시','안양시','남양주시','화성시','평택시',
      '의정부시','시흥시','파주시','김포시','광명시','광주시','군포시','하남시','오산시','이천시',
      '안성시','의왕시','양주시','구리시','포천시','여주시','동두천시','과천시','가평군','양평군','연천군')) then
    raise exception '경기는 사는 시·군을 선택해 주세요.';
  end if;

  if v_region not in ('서울', '경기') then
    v_district := null;
  end if;

  if not (v_meet <@ array['서울','경기','인천','강원','충청','전라','경상','제주']::text[]) then
    raise exception '만날 수 있는 지역을 다시 선택해 주세요.';
  end if;

  if (v_age_min is not null and v_age_min not between 19 and 80)
     or (v_age_max is not null and v_age_max not between 19 and 80)
     or (v_age_min is not null and v_age_max is not null and v_age_min > v_age_max) then
    raise exception '원하는 상대 나이를 다시 확인해 주세요.';
  end if;

  -- 사진은 반드시 이 이력서 번호 폴더 안에 실제로 올라가 있어야 해요.
  if v_photo is null or split_part(v_photo, '/', 1) <> v_id::text
     or not exists (select 1 from storage.objects where bucket_id = 'photos' and name = v_photo) then
    raise exception '대표 사진을 다시 올려 주세요.';
  end if;

  foreach v_path in array v_extras loop
    if split_part(v_path, '/', 1) <> v_id::text
       or not exists (select 1 from storage.objects where bucket_id = 'photos' and name = v_path) then
      raise exception '추가 사진·영상을 다시 올려 주세요.';
    end if;
  end loop;

  insert into public.resumes (
    id, nickname, intro, gender, age, height, region, district, job, mbti,
    photo_path, extra_photo_paths, weekend, keywords, good_match, bad_match,
    meet_regions, pref_age_min, pref_age_max, birth_date
  ) values (
    v_id,
    trim(p_resume ->> 'nickname'),
    trim(p_resume ->> 'intro'),
    p_resume ->> 'gender',
    v_age,
    nullif(p_resume ->> 'height', '')::int,
    v_region,
    v_district,
    nullif(trim(p_resume ->> 'job'), ''),
    nullif(p_resume ->> 'mbti', ''),
    v_photo,
    v_extras,
    nullif(trim(p_resume ->> 'weekend'), ''),
    coalesce(array(select jsonb_array_elements_text(p_resume -> 'keywords')), '{}'),
    trim(p_resume ->> 'good_match'),
    trim(p_resume ->> 'bad_match'),
    v_meet,
    v_age_min,
    v_age_max,
    v_birth
  );

  insert into public.contacts (resume_id, contact, email, is_adult, privacy_agreed, rules_agreed)
  values (
    v_id,
    trim(p_contact ->> 'contact'),
    nullif(trim(p_contact ->> 'email'), ''),
    coalesce((p_contact ->> 'is_adult')::boolean, false),
    coalesce((p_contact ->> 'privacy_agreed')::boolean, false),
    coalesce((p_contact ->> 'rules_agreed')::boolean, false)
  );

  return v_id;
end;
$$;

create or replace function public.submit_feedback(p_kind text, p_body text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.feedback (kind, body) values (nullif(p_kind, ''), trim(p_body));
$$;

revoke all on function public.submit_application(jsonb, jsonb) from public;
revoke all on function public.submit_feedback(text, text) from public;
grant execute on function public.submit_application(jsonb, jsonb) to anon, authenticated;
grant execute on function public.submit_feedback(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. 사진 저장소 (비공개 버킷)
--    방문자는 올리기만 가능, 보기·목록·삭제는 관리자만.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "visitor upload photos" on storage.objects;
drop policy if exists "admin read photos"     on storage.objects;
drop policy if exists "admin delete photos"   on storage.objects;

create policy "visitor upload photos" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

create policy "admin read photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and public.is_admin());

create policy "admin delete photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin());

-- ---------------------------------------------------------------------
-- 5-1. 매칭 일지 + 만남 후 확인 (관리자만)
--      단계: 남성 제안 → 여성 제안 → 만남 진행 → 종료 (중간 거절 가능)
-- ---------------------------------------------------------------------
create table if not exists public.matches (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  man_id            uuid not null references public.resumes(id) on delete cascade,
  woman_id          uuid not null references public.resumes(id) on delete cascade,
  stage             text not null default '남성 제안'
                    check (stage in ('남성 제안', '남성 거절', '여성 제안', '여성 거절', '만남 진행', '종료')),
  man_offered_at    timestamptz not null default now(),
  woman_offered_at  timestamptz,
  contact_sent_at   timestamptz,
  ended_at          timestamptz,
  outcome           text check (outcome in ('교제', '만남 후 종료', '연락 두절', '기타')),
  man_feel          text check (man_feel in ('좋았어요', '보통이에요', '아쉬웠어요')),
  man_again         text check (man_again in ('있어요', '없어요', '모르겠어요')),
  man_issue         text check (char_length(man_issue) <= 1000),
  woman_feel        text check (woman_feel in ('좋았어요', '보통이에요', '아쉬웠어요')),
  woman_again       text check (woman_again in ('있어요', '없어요', '모르겠어요')),
  woman_issue       text check (char_length(woman_issue) <= 1000),
  checked_at        timestamptz,
  note              text check (char_length(note) <= 2000),
  constraint matches_pair_unique unique (man_id, woman_id)
);

-- 한 사람은 동시에 한 만남만 (주의사항 2번)
create unique index if not exists matches_one_meeting_man   on public.matches (man_id)   where stage = '만남 진행';
create unique index if not exists matches_one_meeting_woman on public.matches (woman_id) where stage = '만남 진행';

create or replace function public.matches_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select gender from public.resumes where id = new.man_id) is distinct from '남성'
     or (select gender from public.resumes where id = new.woman_id) is distinct from '여성' then
    raise exception '남성과 여성 이력서를 하나씩 골라 주세요.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists matches_guard on public.matches;
create trigger matches_guard before insert or update on public.matches
  for each row execute function public.matches_guard();

alter table public.matches enable row level security;
drop policy if exists "admin all matches" on public.matches;
create policy "admin all matches" on public.matches for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 6. 관리자 등록 (본인 이메일로 바꿔서 실행)
-- ---------------------------------------------------------------------
-- insert into public.admins (email) values ('관리자이메일@example.com') on conflict do nothing;

-- ---------------------------------------------------------------------
-- 7. (선택) 보관 기한이 지난 연락처 자동 삭제
--    Database → Extensions 에서 pg_cron 을 켠 뒤 아래 주석을 풀고 실행하세요.
-- ---------------------------------------------------------------------
-- select cron.schedule(
--   'purge-expired-contacts',
--   '0 3 * * *',
--   $$ delete from public.contacts where delete_after < current_date $$
-- );
