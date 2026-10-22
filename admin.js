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
    $("#tab-resumes").hidden = b.dataset.tab !== "resumes";
    $("#tab-feedback").hidden = b.dataset.tab !== "feedback";
  }));

  $$(".filter").forEach((b) => b.addEventListener("click", () => {
    $$(".filter").forEach((x) => x.classList.toggle("is-on", x === b));
    statusFilter = b.dataset.status;
    renderResumes();
  }));

  // ---------- 데이터 ----------
  async function loadAll() {
    const [r, c, f] = await Promise.all([
      db.from("resumes").select("*").order("created_at", { ascending: false }),
      db.from("contacts").select("*"),
      db.from("feedback").select("*").order("created_at", { ascending: false }),
    ]);
    if (r.error || c.error || f.error) {
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
    renderResumes();
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

  db.auth.onAuthStateChange(() => {});
  refreshSession();
})();
