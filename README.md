# 선생님 이력서 소개팅

여선생님과 자기 일에 진심인 남성을 이어주는 이력서 기반 소개팅 사이트예요.
화면은 GitHub Pages, 데이터·사진 저장은 Supabase가 맡아요.

## 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 소개 화면 + 이력서 → 연락처 → 완료로 이어지는 신청서 + 피드백 |
| `review.html` | 만남 후기 페이지 (관리자 화면 매칭 카드에서 복사한 링크로만 열려요) |
| `admin.html` | 운영자 전용 화면 (로그인 후 이력서·연락처·피드백 열람, 상태 변경) |
| `config.js` | Supabase 주소와 공개 키 |
| `supabase/schema.sql` | 테이블, 보안 규칙, 사진 저장소 설정 |

## 1. Supabase 준비 (한 번만)

1. [supabase.com](https://supabase.com)에서 새 프로젝트를 만들어요. 지역은 Northeast Asia (Seoul)을 고르면 빨라요.
2. 왼쪽 메뉴 **SQL Editor**를 열고 `supabase/schema.sql` 내용을 통째로 붙여넣은 뒤 **Run**을 눌러요.
3. **Authentication → Providers → Email**에서 이메일 로그인을 켜고, **Authentication → Sign In / Providers**에서 **Allow new users to sign up**을 꺼요. (아무나 계정을 만들지 못하게)
4. **Authentication → Users → Add user**로 운영자 계정(이메일+비밀번호)을 만들어요.
5. SQL Editor에서 아래를 운영자 이메일로 바꿔 실행해요.
   ```sql
   insert into public.admins (email) values ('운영자이메일@example.com');
   ```
6. **Project Settings → API**에서 `Project URL`과 `anon public` 키를 복사해 `config.js`에 넣어요.
   `service_role` 키는 절대 넣지 마세요.

## 2. GitHub Pages로 배포

1. 이 폴더를 GitHub 저장소에 올려요.
2. 저장소 **Settings → Pages → Build and deployment**에서 Source를 **Deploy from a branch**, Branch를 `main` / `(root)`로 정하고 저장해요.
3. 1~2분 뒤 `https://아이디.github.io/저장소이름/`에서 열려요.
   - 신청 화면: `.../`
   - 운영자 화면: `.../admin.html`

## 보안 구조

- 방문자는 **제출만** 할 수 있고, 다른 사람의 이력서·연락처·사진을 읽을 수 없어요. (RLS + 제출 함수)
- 이력서와 연락처는 함수 하나로 **함께 저장**돼요. 둘 중 하나만 저장되는 일은 없어요.
- 사진은 **비공개 저장소**에 올라가고, 운영자 화면에서만 1시간짜리 임시 링크로 보여요.
- 운영자 화면은 `admins` 명단에 있는 이메일로 로그인해야만 데이터를 볼 수 있어요.

## 보관 기간

연락처는 기본으로 **수집일로부터 6개월** 뒤 `delete_after` 날짜가 찍혀요.
신청서의 동의 문구도 같은 기간을 보여줘요.

- 기간을 바꾸려면 `config.js`의 `CONTACT_RETENTION_MONTHS`와 `schema.sql`의 `interval '6 months'`를 함께 바꿔요.
- 자동 삭제를 켜려면 Supabase **Database → Extensions**에서 `pg_cron`을 켜고 `schema.sql` 맨 아래 7번 주석을 풀어 실행해요.

## 알아두기

- 스팸 제출이 늘면 Supabase의 CAPTCHA(hCaptcha/Turnstile) 연동을 추가하는 걸 권해요.
- 소개 화면의 「신원 확인」 약속은 실제 확인 절차를 운영할 때만 유지하세요.
