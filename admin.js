(function () {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
    $("#config-warning").hidden = false;
    return;
  }

  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  let resumes = [];
  let statusFilter = "";

  // ---------- 로그인 ----------
  async function refreshSession() {
    const { data } = await db.auth.getSession();
    const signedIn = Boolean(data.session);
    $("#login-view").hidden = signedIn;
    $("#data-view").hidden = !signedIn;
    $("#logout").hidden = !signedIn;
    if (signedIn) await loadAll();
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#login-error");
    err.hidden = true;
    const { error } = await db.auth.signInWithPassword({
      email: $("#login-email").value.trim(),
      password: $("#login-pw").value,
    });
    if (error) {
      err.textContent = "이메일 또는 비밀번호가 맞지 않아요.";
      err.hidden = false;
      return;
    }
    refreshSession();
  });

  $("#logout").addEventListener("click", async () => {
    await db.auth.signOut();
    refreshSession();
  });

  // ---------- 탭 ----------
  $$(".tabs button").forEach((b) => b.addEventListener("click", () => {
    $$(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    ["resumes", "matches", "stats", "feedback"].forEach((t) => { $(`#tab-${t}`).hidden = b.dataset.tab !== t; });
  }));

  $$("#tab-resumes .filter").forEach((b) => b.addEventListener("click", () => {
    $$("#tab-resumes .filter").forEach((x) => x.classList.toggle("is-on", x === b));
    statusFilter = b.dataset.status;
    renderResumes();
  }));

  // ---------- 데이터 ----------
  async function loadAll() {
    const [r, c, f, mt] = await Promise.all([
      db.from("resumes").select("*").order("created_at", { ascending: false }),
      db.from("contacts").select("*"),
      db.from("feedback").select("*").order("created_at", { ascending: false }),
      db.from("matches").select("*").order("created_at", { ascending: false }),
    ]);
    if (r.error || c.error || f.error || mt.error) {
      $("#resume-list").innerHTML = "";
      const msg = document.createElement("p");
      msg.className = "error";
      msg.textContent = "불러오지 못했어요. 이 계정이 관리자 명단(admins)에 등록돼 있는지 확인해 주세요.";
      $("#resume-list").appendChild(msg);
      return;
    }
    const contactById = new Map(c.data.map((x) => [x.resume_id, x]));
    resumes = r.data.map((x) => ({ ...x, contact: contactById.get(x.id) }));
    $("#count-resumes").textContent = String(resumes.length);
    $("#count-feedback").textContent = String(f.data.length);
    matches = mt.data;
    refreshMatchViews();
    renderFeedback(f.data);
  }

  async function signed(path) {
    const { data } = await db.storage.from("photos").createSignedUrl(path, 3600);
    return data ? data.signedUrl : "";
  }

  function addRow(dl, label, value) {
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return;
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = Array.isArray(value) ? value.join(", ") : String(value);
    dl.append(dt, dd);
  }

  // 생년월일이 있으면 오늘(한국 시간) 기준 만 나이, 없으면 제출 당시 나이
  function currentAge(x) {
    if (!x.birth_date) return x.age;
    const [y, m, d] = x.birth_date.split("-").map(Number);
    const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()).split("-").map(Number);
    let a = t[0] - y;
    if (t[1] < m || (t[1] === m && t[2] < d)) a -= 1;
    return a;
  }

  const fmtDate = (s) => new Date(s).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });

  function renderResumes() {
    const list = $("#resume-list");
    list.innerHTML = "";
    const shown = resumes.filter((x) => !statusFilter || x.status === statusFilter);
    $("#resume-empty").hidden = shown.length > 0;
    const tpl = $("#card-tpl");

    shown.forEach((x) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.status = x.status;
      $(".card-name", node).textContent = `${x.nickname} · ${x.gender} 만 ${currentAge(x)}세`;
      if (meetingOf(x.id)) $(".card-name", node).append(el("span", { class: "busy-badge", text: "만남 중" }));
      $(".card-intro", node).textContent = x.intro;

      const meta = $(".card-meta", node);
      addRow(meta, "지역", [x.region, x.district].filter(Boolean).join(" "));
      addRow(meta, "생년월일", x.birth_date);
      addRow(meta, "만남 가능", x.meet_regions);
      addRow(meta, "원하는 나이",
        x.pref_age_min || x.pref_age_max ? `${x.pref_age_min ?? "?"}~${x.pref_age_max ?? "?"}세` : "");
      addRow(meta, "직업", x.job);
      addRow(meta, "키", x.height ? `${x.height}cm` : "");
      addRow(meta, "MBTI", x.mbti);
      addRow(meta, "제출일", fmtDate(x.created_at));

      const detail = $(".card-detail", node);
      addRow(detail, "주말", x.weekend);
      addRow(detail, "키워드", x.keywords);
      addRow(detail, "잘 맞아요", x.good_match);
      addRow(detail, "안 맞아요", x.bad_match);

      const cd = $(".contact-detail", node);
      if (x.contact) {
        addRow(cd, "연락처", x.contact.contact);
        addRow(cd, "이메일", x.contact.email);
        addRow(cd, "주의사항 동의", x.contact.rules_agreed ? "동의함" : "기록 없음");
        addRow(cd, "파기 예정", fmtDate(x.contact.delete_after));
      } else {
        addRow(cd, "연락처", "없음");
      }

      const sel = $(".card-status", node);
      sel.value = x.status;
      sel.addEventListener("change", async () => {
        const prev = x.status;
        const { error } = await db.from("resumes").update({ status: sel.value }).eq("id", x.id);
        if (error) { sel.value = prev; alert("상태를 바꾸지 못했어요."); return; }
        x.status = sel.value;
        node.dataset.status = sel.value;
        if (statusFilter && statusFilter !== sel.value) renderResumes();
      });

      const delBtn = $(".card-delete", node);
      delBtn.addEventListener("click", () => deleteResume(x, delBtn));

      const img = $(".card-photo", node);
      img.alt = `${x.nickname} 대표 사진`;
      signed(x.photo_path).then((u) => { if (u) img.src = u; });

      const more = $(".card-more", node);
      more.addEventListener("toggle", async () => {
        const box = $(".card-extras", node);
        if (!more.open || box.childElementCount || !x.extra_photo_paths.length) return;
        for (const p of x.extra_photo_paths) {
          const u = await signed(p);
          if (!u) continue;
          const el = /\.(mp4|mov)$/i.test(p) ? document.createElement("video") : document.createElement("img");
          el.src = u;
          if (el.tagName === "VIDEO") el.controls = true; else el.alt = "추가 사진";
          box.appendChild(el);
        }
      });

      list.appendChild(node);
    });
  }

  // 이력서·연락처·사진·매칭 기록을 한 번에 지워요 (탈퇴·파기 요청, 테스트 가입 정리용)
  async function deleteResume(x, btn) {
    const n = matches.filter((m) => m.man_id === x.id || m.woman_id === x.id).length;
    const msg = `${x.nickname}님의 이력서, 연락처, 사진을 모두 삭제할까요?`
      + (n ? `\n이 회원의 매칭 기록 ${n}건도 함께 지워져요.` : "")
      + "\n삭제하면 되돌릴 수 없어요.";
    if (!confirm(msg)) return;

    const reset = () => { btn.disabled = false; btn.textContent = "이력서 삭제"; };
    btn.disabled = true;
    btn.textContent = "삭제하는 중…";

    // 1) 사진 먼저: 실패하면 아무것도 지우지 않고 멈춰요
    const paths = [x.photo_path, ...(x.extra_photo_paths || [])].filter(Boolean);
    if (paths.length) {
      const { error } = await db.storage.from("photos").remove(paths);
      if (error) {
        alert(`사진을 지우지 못해 삭제를 멈췄어요. 잠시 후 다시 시도해 주세요. (${error.message})`);
        reset();
        return;
      }
    }

    // 2) 이력서 삭제 → 연락처·매칭 기록은 자동으로 함께 지워져요
    const { data, error } = await db.from("resumes").delete().eq("id", x.id).select("id");
    if (error || !data || !data.length) {
      alert("이력서를 지우지 못했어요. 관리자 계정으로 로그인했는지 확인해 주세요.");
      reset();
      return;
    }

    resumes = resumes.filter((r) => r.id !== x.id);
    matches = matches.filter((m) => m.man_id !== x.id && m.woman_id !== x.id);
    $("#count-resumes").textContent = String(resumes.length);
    refreshMatchViews();
  }

  function renderFeedback(rows) {
    const body = $("#feedback-list");
    body.innerHTML = "";
    $("#feedback-empty").hidden = rows.length > 0;
    rows.forEach((f) => {
      const tr = document.createElement("tr");
      [fmtDate(f.created_at), f.kind || "-", f.body].forEach((t) => {
        const td = document.createElement("td");
        td.textContent = t;
        tr.appendChild(td);
      });
      const td = document.createElement("td");
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", "처리 상태");
      ["확인 전", "확인함", "반영 완료"].forEach((o) => sel.add(new Option(o, o)));
      sel.value = f.handled;
      sel.addEventListener("change", async () => {
        const { error } = await db.from("feedback").update({ handled: sel.value }).eq("id", f.id);
        if (error) { sel.value = f.handled; alert("처리 상태를 바꾸지 못했어요."); return; }
        f.handled = sel.value;
      });
      td.appendChild(sel);
      tr.appendChild(td);
      body.appendChild(tr);
    });
  }

  // =====================================================================
  // 매칭 일지 · 만남 후 확인 · 통계
  // 단계: 남성 제안 → 여성 제안 → 만남 진행 → 종료 (중간에 남성 거절 / 여성 거절)
  // =====================================================================
  let matches = [];
  let matchFilter = "open";
  let lastSaved = null;
  const openChecks = new Set();
  const OPEN = ["남성 제안", "여성 제안"];
  const ENDED = ["남성 거절", "여성 거절", "종료"];
  const OUTCOMES = ["교제", "만남 후 종료", "연락 두절", "기타"];
  const MAN_YES = ["여성 제안", "여성 거절", "만남 진행", "종료"];
  const WOMAN_YES = ["만남 진행", "종료"];

  const byId = (id) => resumes.find((r) => r.id === id);
  const meetingOf = (id) => matches.find((m) => m.stage === "만남 진행" && (m.man_id === id || m.woman_id === id));
  const now = () => new Date().toISOString();
  const shortDate = (s) => (s ? new Date(s).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" }) : "");
  const daysBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "–");
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (v === undefined || v === null || v === false) return;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    kids.flat().forEach((k) => { if (k !== null && k !== undefined && k !== false) n.append(k); });
    return n;
  }

  function personLabel(r) {
    if (!r) return "삭제된 이력서";
    const where = [r.region, r.district].filter(Boolean).join(" ");
    return `${r.nickname} · 만 ${currentAge(r)}세 · ${where}`;
  }

  function refreshMatchViews() {
    renderMatches();
    fillCandidates();
    renderStats();
    renderResumes();
  }

  // ---------- 새 매칭 ----------
  const nmMan = $("#nm-man");
  const nmWoman = $("#nm-woman");
  const nmFit = $("#nm-fit");
  const nmError = $("#nm-error");

  function fillCandidates() {
    const keep = [nmMan.value, nmWoman.value];
    [[nmMan, "남성"], [nmWoman, "여성"]].forEach(([sel, g], i) => {
      sel.length = 1;
      resumes
        .filter((r) => r.gender === g && r.status !== "비공개" && !meetingOf(r.id))
        .sort((a, b) => (a.status === "공개" ? 0 : 1) - (b.status === "공개" ? 0 : 1))
        .forEach((r) => sel.add(new Option(`${personLabel(r)}${r.status === "공개" ? "" : ` (${r.status})`}`, r.id)));
      sel.value = Array.from(sel.options).some((o) => o.value === keep[i]) ? keep[i] : "";
    });
    showFit();
  }

  function ageFits(age, r) {
    if (!r.pref_age_min && !r.pref_age_max) return null;
    return (!r.pref_age_min || age >= r.pref_age_min) && (!r.pref_age_max || age <= r.pref_age_max);
  }

  function showFit() {
    nmFit.innerHTML = "";
    nmError.hidden = true;
    const m = byId(nmMan.value);
    const w = byId(nmWoman.value);
    if (!m || !w) return;
    const range = (r) => `${r.pref_age_min ?? "?"}~${r.pref_age_max ?? "?"}세`;
    const mr = m.meet_regions || [];
    const wr = w.meet_regions || [];
    const common = mr.filter((x) => wr.includes(x));
    const checks = [
      [`여성분이 원하는 나이 ${range(w)} · 남성 만 ${currentAge(m)}세`, ageFits(currentAge(m), w)],
      [`남성분이 원하는 나이 ${range(m)} · 여성 만 ${currentAge(w)}세`, ageFits(currentAge(w), m)],
      [`만날 수 있는 지역 겹침: ${common.length ? common.join(", ") : "없음"}`, mr.length && wr.length ? common.length > 0 : null],
    ];
    const ul = el("ul", { class: "fit-list" });
    checks.forEach(([t, ok]) => ul.append(el("li", { class: ok === null ? "fit-unknown" : ok ? "fit-ok" : "fit-no" },
      el("b", { text: ok === null ? "정보 없음" : ok ? "맞아요" : "안 맞아요" }), t)));
    nmFit.append(ul);
    const waiting = matches.filter((x) => x.man_id === m.id && OPEN.includes(x.stage)).length;
    if (waiting) nmFit.append(el("p", { class: "hint", text: `이 남성분은 이미 답을 기다리는 제안이 ${waiting}건 있어요.` }));
    if (matches.some((x) => x.man_id === m.id && x.woman_id === w.id)) {
      nmFit.append(el("p", { class: "error", text: "이미 기록된 조합이에요. 아래 목록의 '전체'에서 찾아보세요." }));
    }
  }
  nmMan.addEventListener("change", showFit);
  nmWoman.addEventListener("change", showFit);

  $("#new-match").addEventListener("submit", async (e) => {
    e.preventDefault();
    nmError.hidden = true;
    if (!nmMan.value || !nmWoman.value) {
      nmError.textContent = "남성과 여성을 한 명씩 골라 주세요.";
      nmError.hidden = false;
      return;
    }
    const btn = $('button[type="submit"]', e.target);
    btn.disabled = true;
    const { data, error } = await db.from("matches")
      .insert({ man_id: nmMan.value, woman_id: nmWoman.value }).select().single();
    btn.disabled = false;
    if (error) {
      nmError.textContent = error.code === "23505" ? "이미 기록된 조합이에요." : `기록하지 못했어요. (${error.message})`;
      nmError.hidden = false;
      return;
    }
    matches.unshift(data);
    nmMan.value = "";
    nmWoman.value = "";
    setMatchFilter("open");
    refreshMatchViews();
  });

  // ---------- 목록 ----------
  function setMatchFilter(f) {
    matchFilter = f;
    $$(".mfilter").forEach((x) => x.classList.toggle("is-on", x.dataset.f === f));
  }
  $$(".mfilter").forEach((b) => b.addEventListener("click", () => { setMatchFilter(b.dataset.f); renderMatches(); }));

  function renderMatches() {
    const list = $("#match-list");
    list.innerHTML = "";
    const shown = matches.filter((m) =>
      matchFilter === "all" ? true
        : matchFilter === "open" ? OPEN.includes(m.stage)
        : matchFilter === "meeting" ? m.stage === "만남 진행"
        : ENDED.includes(m.stage));
    $("#match-empty").hidden = shown.length > 0;
    const active = matches.filter((m) => OPEN.includes(m.stage) || m.stage === "만남 진행").length;
    $("#count-matches").textContent = active ? String(active) : "";
    shown.forEach((m) => list.append(matchCard(m)));
  }

  async function updateMatch(m, patch) {
    const { data, error } = await db.from("matches").update(patch).eq("id", m.id).select().single();
    if (error) {
      alert(error.code === "23505"
        ? "두 사람 중 한 명이 이미 다른 만남 중이에요. 그 만남을 먼저 정리해 주세요."
        : `저장하지 못했어요. (${error.message})`);
      return false;
    }
    Object.assign(m, data);
    lastSaved = m.id;
    refreshMatchViews();
    return true;
  }

  const NEXT = {
    "남성 제안": [
      ["남성 수락 → 여성에게 제안함", "btn-pink", () => ({ stage: "여성 제안", woman_offered_at: now() })],
      ["남성 거절", "btn-ghost", () => ({ stage: "남성 거절", ended_at: now() })],
    ],
    "여성 제안": [
      ["여성 수락 → 연락처 전달함", "btn-pink", () => ({ stage: "만남 진행", contact_sent_at: now() })],
      ["여성 거절", "btn-ghost", () => ({ stage: "여성 거절", ended_at: now() })],
    ],
  };
  const BACK = {
    "남성 거절": { stage: "남성 제안", ended_at: null },
    "여성 제안": { stage: "남성 제안", woman_offered_at: null },
    "여성 거절": { stage: "여성 제안", ended_at: null },
    "만남 진행": { stage: "여성 제안", contact_sent_at: null },
    "종료": { stage: "만남 진행", ended_at: null, outcome: null },
  };

  function selectField(name, label, options, value) {
    const sel = el("select", { name }, el("option", { value: "", text: "—" }),
      options.map((o) => el("option", { value: o, text: o })));
    sel.value = value || "";
    return el("label", { class: "mini" }, label, sel);
  }

  function textField(name, label, value, max) {
    const ta = el("textarea", { name, rows: "2", maxlength: String(max) });
    ta.value = value || "";
    return el("label", { class: "mini" }, label, ta);
  }

  function matchCard(m) {
    const man = byId(m.man_id);
    const woman = byId(m.woman_id);
    const card = el("article", { class: "mcard", "data-stage": m.stage });

    card.append(el("header", { class: "mcard-head" },
      el("h3", {},
        el("span", { class: "who who-m", text: personLabel(man) }),
        el("span", { class: "pair-arrow", "aria-hidden": "true", text: "↔" }),
        el("span", { class: "who who-w", text: personLabel(woman) })),
      el("span", { class: "stage-badge", text: m.stage === "종료" && m.outcome ? `종료 · ${m.outcome}` : m.stage })));

    const lastStep = m.stage.includes("거절") ? m.stage : "종료";
    const tl = el("ol", { class: "timeline", "aria-label": "진행 기록" });
    [["남성 제안", m.man_offered_at], ["여성 제안", m.woman_offered_at], ["연락처 전달", m.contact_sent_at], [lastStep, m.ended_at]]
      .forEach(([t, d]) => tl.append(el("li", { class: d ? "is-done" : "" }, el("span", { text: t }), el("small", { text: d ? shortDate(d) : "—" }))));
    card.append(tl);

    if (OPEN.includes(m.stage)) {
      [man, woman].forEach((r) => {
        const other = r && meetingOf(r.id);
        if (other && other.id !== m.id) {
          card.append(el("p", { class: "warn", text: `${r.nickname}님은 지금 다른 만남 중이에요. 그 만남이 끝날 때까지 이 매칭은 멈춰 주세요.` }));
        }
      });
    }

    const met = m.stage === "만남 진행" || m.stage === "종료";
    const needsCheck = met && !m.checked_at && m.contact_sent_at && daysBetween(m.contact_sent_at, now()) >= 3;
    if (needsCheck) card.append(el("p", { class: "remind", text: "연락처를 전달한 지 3일이 지났어요. 만남 후 확인을 해 주세요." }));

    // 단계 버튼
    const actions = el("div", { class: "mcard-actions" });
    (NEXT[m.stage] || []).forEach(([label, cls, patch]) => actions.append(
      el("button", { type: "button", class: `btn btn-sm ${cls}`, text: label, onclick: () => updateMatch(m, patch()) })));
    if (m.stage === "만남 진행") {
      const sel = el("select", { class: "sel-sm", "aria-label": "만남 결과" },
        el("option", { value: "", text: "만남 결과 고르기" }), OUTCOMES.map((o) => el("option", { value: o, text: o })));
      actions.append(sel, el("button", {
        type: "button", class: "btn btn-sm btn-pink", text: "만남 종료로 기록",
        onclick: () => {
          if (!sel.value) { sel.focus(); sel.classList.add("invalid"); return; }
          updateMatch(m, { stage: "종료", outcome: sel.value, ended_at: now() });
        },
      }));
    }
    if (m.stage === "종료") {
      const sel = el("select", { class: "sel-sm", "aria-label": "만남 결과 바꾸기" }, OUTCOMES.map((o) => el("option", { value: o, text: o })));
      sel.value = m.outcome || "기타";
      sel.addEventListener("change", () => updateMatch(m, { outcome: sel.value }));
      actions.append(el("label", { class: "inline-label" }, "결과", sel));
    }
    if (BACK[m.stage]) {
      actions.append(el("button", { type: "button", class: "btn-link", text: "한 단계 되돌리기", onclick: () => updateMatch(m, BACK[m.stage]) }));
    }
    if (m.stage === "남성 제안") {
      actions.append(el("button", {
        type: "button", class: "btn-link", text: "기록 삭제",
        onclick: async () => {
          if (!confirm("이 매칭 기록을 지울까요?")) return;
          const { error } = await db.from("matches").delete().eq("id", m.id);
          if (error) { alert("지우지 못했어요."); return; }
          matches = matches.filter((x) => x.id !== m.id);
          refreshMatchViews();
        },
      }));
    }
    card.append(actions);

    // 만남 후 확인 + 메모
    const det = el("details", { class: "mcard-more" });
    det.open = openChecks.has(m.id) || Boolean(needsCheck);
    det.addEventListener("toggle", () => { if (det.open) openChecks.add(m.id); else openChecks.delete(m.id); });
    det.append(el("summary", { text: met ? `만남 후 확인 · 메모${m.checked_at ? " (확인함)" : ""}` : `메모${m.note ? " (있음)" : ""}` }));

    const form = el("form", { class: "check-form" });
    if (met) {
      form.append(el("p", { class: "hint", text: "만남 2~3일 뒤 양쪽에 물어보고 적어 주세요. 이 내용은 상대에게 전달하지 않아요." }));
      const cols = el("div", { class: "check-cols" });
      [["man", "남성", man], ["woman", "여성", woman]].forEach(([k, g, r]) => cols.append(
        el("fieldset", { class: "check-col" },
          el("legend", { text: `${g} · ${r ? r.nickname : ""}` }),
          selectField(`${k}_feel`, "만남은 어떠셨나요?", ["좋았어요", "보통이에요", "아쉬웠어요"], m[`${k}_feel`]),
          selectField(`${k}_again`, "다시 만날 의향", ["있어요", "없어요", "모르겠어요"], m[`${k}_again`]),
          textField(`${k}_issue`, "불편했던 점", m[`${k}_issue`], 1000))));
      form.append(cols);
    }
    form.append(textField("note", "운영 메모", m.note, 2000));
    form.append(el("div", { class: "mcard-actions" },
      el("button", { type: "submit", class: "btn btn-sm btn-dark", text: "저장" }),
      lastSaved === m.id ? el("span", { class: "status", text: "저장했어요" }) : null));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const clean = (k) => (fd.get(k) || "").trim() || null;
      const patch = { note: clean("note") };
      if (met) {
        ["man", "woman"].forEach((k) => {
          patch[`${k}_feel`] = fd.get(`${k}_feel`) || null;
          patch[`${k}_again`] = fd.get(`${k}_again`) || null;
          patch[`${k}_issue`] = clean(`${k}_issue`);
        });
        const answered = patch.man_feel || patch.woman_feel || patch.man_again || patch.woman_again;
        patch.checked_at = answered ? (m.checked_at || now()) : null;
      }
      openChecks.add(m.id);
      await updateMatch(m, patch);
    });
    det.append(form);
    card.append(det);
    return card;
  }

  // ---------- 통계 ----------
  function statSection(title, note, ...nodes) {
    return el("section", { class: "stat-sec" }, el("h2", { text: title }), note ? el("p", { class: "hint", text: note }) : null, ...nodes);
  }

  function tiles(items) {
    return el("div", { class: "tiles" }, items.map(([label, value, sub]) =>
      el("div", { class: "tile" }, el("p", { class: "tile-label", text: label }), el("p", { class: "tile-value", text: value }),
        sub ? el("p", { class: "tile-sub", text: sub }) : null)));
  }

  function bars(rows, max) {
    return el("div", { class: "bars" }, rows.map(([label, value, sub]) =>
      el("div", { class: "bar-row" },
        el("span", { class: "bar-label", text: label }),
        el("span", { class: "bar-track" }, el("span", { class: "bar-fill", style: `width:${max ? (value / max) * 100 : 0}%` })),
        el("span", { class: "bar-value", text: `${value}${sub ? ` · ${sub}` : ""}` }))));
  }

  const fmtDays = (d) => (d === null ? "–" : d < 1 ? "하루 미만" : `${Math.round(d)}일`);

  function weekStart(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }

  function renderStats() {
    const box = $("#stats");
    box.innerHTML = "";
    const count = (arr, g) => arr.filter((r) => r.gender === g).length;

    // 회원 현황
    const meetings = matches.filter((m) => m.stage === "만남 진행");
    const meetingIds = new Set(meetings.flatMap((m) => [m.man_id, m.woman_id]));
    const avail = resumes.filter((r) => r.status !== "비공개" && !meetingIds.has(r.id));
    box.append(statSection("회원 현황", "", tiles([
      ["전체 이력서", `${resumes.length}명`, `남 ${count(resumes, "남성")} · 여 ${count(resumes, "여성")}`],
      ["매칭 가능", `${avail.length}명`, `남 ${count(avail, "남성")} · 여 ${count(avail, "여성")} (비공개·만남 중 제외)`],
      ["지금 만남 중", `${meetings.length}쌍`, `${meetingIds.size}명`],
    ])));

    // 매칭 흐름
    const n = matches.length;
    const manYes = matches.filter((m) => MAN_YES.includes(m.stage)).length;
    const manDecided = matches.filter((m) => m.stage !== "남성 제안").length;
    const womanYes = matches.filter((m) => WOMAN_YES.includes(m.stage)).length;
    const womanDecided = matches.filter((m) => ["여성 거절", ...WOMAN_YES].includes(m.stage)).length;
    const closed = matches.filter((m) => !OPEN.includes(m.stage)).length;
    const finished = matches.filter((m) => m.stage === "종료");
    const dating = finished.filter((m) => m.outcome === "교제").length;
    box.append(statSection("매칭 흐름", "수락률은 아직 답을 기다리는 건을 빼고 계산해요.",
      bars([
        ["남성에게 제안", n, ""],
        ["남성 수락", manYes, `수락률 ${pct(manYes, manDecided)}`],
        ["여성 수락 (연락처 전달)", womanYes, `수락률 ${pct(womanYes, womanDecided)}`],
        ["교제", dating, `끝난 만남 ${finished.length}건 중 ${pct(dating, finished.length)}`],
      ], n),
      tiles([["최종 성사율", pct(womanYes, closed), `답이 나온 ${closed}건 중 연락처 전달까지 간 비율`]])));

    // 만남 후 확인
    const met = matches.filter((m) => m.contact_sent_at);
    const checked = met.filter((m) => m.checked_at);
    const good = (k) => checked.filter((m) => m[`${k}_feel`] === "좋았어요").length;
    const answered = (k) => checked.filter((m) => m[`${k}_feel`]).length;
    const bothAgain = checked.filter((m) => m.man_again === "있어요" && m.woman_again === "있어요").length;
    const issues = checked.filter((m) => m.man_issue || m.woman_issue).length;
    box.append(statSection("만남 후 확인", "", tiles([
      ["확인 완료", `${checked.length}건`, `연락처 전달 ${met.length}건 중`],
      ["남성 '좋았어요'", pct(good("man"), answered("man")), `응답 ${answered("man")}건`],
      ["여성 '좋았어요'", pct(good("woman"), answered("woman")), `응답 ${answered("woman")}건`],
      ["둘 다 다시 만날 의향", `${bothAgain}건`, issues ? `불편했던 점 기록 ${issues}건` : "불편했던 점 기록 없음"],
    ])));

    // 걸린 시간
    const firstOffer = new Map();
    matches.forEach((m) => {
      [[m.man_id, m.man_offered_at], [m.woman_id, m.woman_offered_at]].forEach(([id, t]) => {
        if (t && (!firstOffer.has(id) || t < firstOffer.get(id))) firstOffer.set(id, t);
      });
    });
    const waitDays = resumes.filter((r) => firstOffer.has(r.id)).map((r) => daysBetween(r.created_at, firstOffer.get(r.id)));
    const toContact = met.map((m) => daysBetween(m.man_offered_at, m.contact_sent_at));
    const noOffer = resumes.filter((r) => r.status !== "비공개" && !firstOffer.has(r.id));
    box.append(statSection("걸린 시간", "", tiles([
      ["가입 → 첫 제안", fmtDays(avg(waitDays)), `평균 · ${waitDays.length}명 기준`],
      ["남성 제안 → 연락처 전달", fmtDays(avg(toContact)), `평균 · ${toContact.length}건 기준`],
      ["아직 제안 못 받은 회원", `${noOffer.length}명`, `남 ${count(noOffer, "남성")} · 여 ${count(noOffer, "여성")} (비공개 제외)`],
    ])));

    // 주별 신규 가입 (최근 8주)
    const thisWeek = weekStart(new Date());
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const s = new Date(thisWeek);
      s.setDate(s.getDate() - 7 * (7 - i));
      return s;
    });
    const weekRows = weeks.map((s) => {
      const e = new Date(s);
      e.setDate(e.getDate() + 7);
      const inWeek = resumes.filter((r) => new Date(r.created_at) >= s && new Date(r.created_at) < e);
      return [s, count(inWeek, "남성"), count(inWeek, "여성")];
    });
    const maxWeek = Math.max(1, ...weekRows.map(([, m, w]) => m + w));
    const table = el("table", { class: "week-table" },
      el("thead", {}, el("tr", {}, el("th", { text: "주 (월요일 시작)" }), el("th", { text: "남" }), el("th", { text: "여" }), el("th", { text: "" }))),
      el("tbody", {}, weekRows.map(([s, m, w]) => el("tr", {},
        el("td", { text: `${s.getMonth() + 1}/${s.getDate()}~` }),
        el("td", { text: String(m) }),
        el("td", { text: String(w) }),
        el("td", { class: "week-bar" },
          el("span", { class: "seg seg-m", style: `width:${(m / maxWeek) * 100}%` }),
          el("span", { class: "seg seg-w", style: `width:${(w / maxWeek) * 100}%` }))))));
    box.append(statSection("주별 신규 가입", "최근 8주", table,
      el("p", { class: "legend" }, el("span", { class: "seg seg-m" }), " 남성 ", el("span", { class: "seg seg-w" }), " 여성")));
  }

  db.auth.onAuthStateChange(() => {});
  refreshSession();
})();
