(function () {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const form = $("#review-form");
  const token = (new URLSearchParams(location.search).get("t") || "").trim();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function show(id) {
    ["#v-loading", "#v-message", "#review-form", "#v-done"].forEach((s) => { $(s).hidden = s !== id; });
  }

  function message(title, body) {
    $("#msg-title").textContent = title;
    $("#msg-body").textContent = body;
    show("#v-message");
  }

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
    message("잠시 후 다시 열어 주세요", "페이지를 불러오지 못했어요. 문제가 계속되면 운영자에게 알려 주세요.");
    return;
  }
  if (!UUID.test(token)) {
    message("링크가 올바르지 않아요", "운영자에게 받은 링크를 그대로 열어 주세요. 일부만 복사되면 열리지 않아요.");
    return;
  }

  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // ---------- 링크 확인 ----------
  (async function init() {
    const { data, error } = await db.rpc("get_review_context", { p_token: token });
    if (error) {
      message("잠시 후 다시 열어 주세요", "연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.");
      return;
    }
    if (!data || data.reason === "invalid") {
      message("링크가 올바르지 않아요", "운영자에게 받은 링크를 그대로 열어 주세요.");
      return;
    }
    if (!data.ok) {
      message("아직 후기를 남길 수 있는 단계가 아니에요", "만남이 성사된 뒤에 다시 열어 주세요.");
      return;
    }
    if (data.partner) $$(".partner-name").forEach((n) => { n.textContent = `${data.partner}님`; });
    $("#already-note").hidden = !data.submitted;
    show("#review-form");
  })();

  // ---------- 4번: 불편했던 점 ----------
  const rudeField = $("#rude-detail-field");
  const rudeDetail = $("#rude_detail");
  $$('input[name="rude"]').forEach((r) => r.addEventListener("change", () => {
    const on = $('input[name="rude"]:checked').value === "있었어요";
    rudeField.hidden = !on;
    rudeDetail.required = on;
    if (on) rudeDetail.focus();
  }));

  // ---------- 검증 ----------
  function clearError(el) {
    const field = el.closest(".field");
    if (!field) return;
    field.classList.remove("invalid");
    $$(".invalid", field).forEach((n) => n.classList.remove("invalid"));
    $$(".field-error", field).forEach((n) => n.remove());
  }

  function showError(el, msg) {
    clearError(el);
    const field = el.closest(".field");
    (el.type === "radio" ? field : el).classList.add("invalid");
    const p = document.createElement("p");
    p.className = "field-error";
    p.textContent = msg;
    field.appendChild(p);
  }

  function validate() {
    let firstBad = null;
    const seen = new Set();
    $$("input, textarea", form).forEach(clearError);
    $$("input, textarea", form).forEach((el) => {
      if (!el.required || el.closest("[hidden]")) return;
      if (el.type === "radio") {
        if (seen.has(el.name)) return;
        seen.add(el.name);
        if (!$(`input[name="${el.name}"]:checked`, form)) {
          showError(el, "하나를 골라 주세요.");
          firstBad = firstBad || el;
        }
      } else if (!el.value.trim()) {
        showError(el, "내용을 적어 주세요.");
        firstBad = firstBad || el;
      }
    });
    if (firstBad) {
      firstBad.closest(".field").scrollIntoView({ block: "center" });
      firstBad.focus({ preventScroll: true });
    }
    return !firstBad;
  }

  $$("input, textarea", form).forEach((el) => {
    el.addEventListener("change", () => clearError(el));
    el.addEventListener("input", () => clearError(el));
  });

  // ---------- 제출 ----------
  const submitBtn = $("#submit-btn");
  const submitError = $("#submit-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitError.hidden = true;
    if (!validate()) return;

    const fd = new FormData(form);
    const answers = {};
    ["feel", "again", "resemble", "rude", "rude_detail", "next_pref", "svc_satisfaction",
      "resume_helpful", "svc_feedback", "recommend", "next_step", "publish_ok"]
      .forEach((k) => { answers[k] = (fd.get(k) || "").toString(); });
    if (answers.rude !== "있었어요") answers.rude_detail = "";

    submitBtn.disabled = true;
    submitBtn.textContent = "보내는 중…";
    const { error } = await db.rpc("submit_review", { p_token: token, p_answers: answers });
    submitBtn.disabled = false;
    submitBtn.textContent = "후기 보내기";

    if (error) {
      submitError.textContent = /[가-힣]/.test(error.message || "")
        ? error.message
        : "보내지 못했어요. 잠시 후 다시 시도해 주세요.";
      submitError.hidden = false;
      return;
    }
    show("#v-done");
    window.scrollTo(0, 0);
    $("#v-done").focus({ preventScroll: true });
  });
})();
