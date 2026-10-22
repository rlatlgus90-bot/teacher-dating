(function () {
  "use strict";

  const SEOUL = ["강남구","강동구","강북구","강서구","관악구","광진구","구로구","금천구","노원구","도봉구",
    "동대문구","동작구","마포구","서대문구","서초구","성동구","성북구","송파구","양천구","영등포구",
    "용산구","은평구","종로구","중구","중랑구"];
  const GYEONGGI = ["수원시","성남시","고양시","용인시","부천시","안산시","안양시","남양주시","화성시","평택시",
    "의정부시","시흥시","파주시","김포시","광명시","광주시","군포시","하남시","오산시","이천시",
    "안성시","의왕시","양주시","구리시","포천시","여주시","동두천시","과천시","가평군","양평군","연천군"];
  const MBTI = ["INTJ","INTP","ENTJ","ENTP","INFJ","INFP","ENFJ","ENFP","ISTJ","ISFJ","ESTJ","ESFJ","ISTP","ISFP","ESTP","ESFP"];
  const REGIONS = ["서울","경기","인천","강원","충청","전라","경상","제주"];
  const KEYWORDS = ["여행","운동","독서","요리","음악","영화","반려동물","사진","게임","카페"];

  const MAX_EXTRAS = 4;
  const MAX_VIDEO_BYTES = 10 * 1024 * 1024;
  const IMAGE_MAX_EDGE = 1600;

  const cfg = window.APP_CONFIG || {};
  const configured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const db = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- 초기 화면 구성 ----------
  if (!configured) $("#config-warning").hidden = false;
  $("#retention-months").textContent = String(cfg.CONTACT_RETENTION_MONTHS || 6);

  const mbtiSel = $("#mbti");
  MBTI.forEach((m) => mbtiSel.add(new Option(m, m)));

  const kwBox = $("#keywords");
  KEYWORDS.forEach((k) => {
    const label = document.createElement("label");
    label.className = "chip";
    label.innerHTML = '<input type="checkbox" name="keywords"><span></span>';
    label.querySelector("input").value = k;
    label.querySelector("span").textContent = k;
    kwBox.appendChild(label);
  });

  const meetBox = $("#meet-regions");
  REGIONS.forEach((r) => {
    const label = document.createElement("label");
    label.className = "chip";
    label.innerHTML = '<input type="checkbox" name="meet_regions"><span></span>';
    label.querySelector("input").value = r;
    label.querySelector("span").textContent = r;
    meetBox.appendChild(label);
  });
  const meetInputs = () => $$('input[name="meet_regions"]', meetBox);

  // ---------- 지역 → 구/시·군 ----------
  const regionSel = $("#region");
  const districtField = $("#district-field");
  const districtSel = $("#district");
  const districtLabel = $("#district-label");

  regionSel.addEventListener("change", () => {
    const r = regionSel.value;
    // 만날 수 있는 지역을 아직 안 골랐으면 사는 지역을 먼저 골라 둬요
    if (r && !meetInputs().some((i) => i.checked)) {
      const own = meetInputs().find((i) => i.value === r);
      if (own) { own.checked = true; clearError(own); }
    }
    const list = r === "서울" ? SEOUL : r === "경기" ? GYEONGGI : null;
    districtSel.innerHTML = "";
    clearError(districtSel);
    if (!list) {
      districtField.hidden = true;
      districtSel.required = false;
      return;
    }
    districtLabel.firstChild.textContent = r === "서울" ? "사는 구 " : "사는 시·군 ";
    districtSel.add(new Option("선택하세요", ""));
    list.forEach((d) => districtSel.add(new Option(d, d)));
    districtSel.required = true;
    districtField.hidden = false;
  });

  // ---------- 대표 사진 미리보기 ----------
  const photoInput = $("#photo");
  const preview = $("#photo-preview");
  photoInput.addEventListener("change", () => {
    const f = photoInput.files[0];
    if (!f) { preview.hidden = true; return; }
    preview.src = URL.createObjectURL(f);
    preview.hidden = false;
    clearError(photoInput);
  });

  // ---------- 검증 ----------
  function showError(el, msg) {
    clearError(el);
    const target = el.type === "radio" || el.type === "checkbox" ? el.closest(".field") : el;
    target.classList.add("invalid");
    const p = document.createElement("p");
    p.className = "field-error";
    p.textContent = msg;
    el.closest(".field").appendChild(p);
  }
  function clearError(el) {
    const field = el.closest(".field");
    if (!field) return;
    field.classList.remove("invalid");
    $$(".invalid", field).forEach((n) => n.classList.remove("invalid"));
    $$(".field-error", field).forEach((n) => n.remove());
  }

  function hiddenInside(el, stepEl) {
    for (let n = el; n && n !== stepEl; n = n.parentElement) {
      if (n.hidden) return true;
    }
    return false;
  }

  function validateStep(stepEl) {
    let firstBad = null;
    const seenRadio = new Set();
    $$("input, select, textarea", stepEl).forEach((el) => {
      if (hiddenInside(el, stepEl)) return;
      clearError(el);
    });
    $$("input, select, textarea", stepEl).forEach((el) => {
      if (hiddenInside(el, stepEl) || !el.required) return;
      let bad = false;
      let msg = "필수 항목이에요.";
      if (el.type === "radio") {
        if (seenRadio.has(el.name)) return;
        seenRadio.add(el.name);
        bad = !$$(`input[name="${el.name}"]`, stepEl).some((r) => r.checked);
        msg = "하나를 골라 주세요.";
      } else if (el.type === "checkbox") {
        bad = !el.checked;
        msg = "동의해야 제출할 수 있어요.";
      } else if (el.type === "file") {
        bad = el.files.length === 0;
        msg = "사진을 올려 주세요.";
      } else {
        bad = !el.value.trim();
        if (!bad && !el.checkValidity()) { bad = true; msg = el.validationMessage; }
      }
      if (bad) {
        showError(el, msg);
        firstBad = firstBad || el;
      }
    });
    // 만날 수 있는 지역: 하나 이상
    const meetFirst = $('input[name="meet_regions"]', stepEl);
    if (meetFirst && !meetInputs().some((i) => i.checked)) {
      showError(meetFirst, "하나 이상 골라 주세요.");
      firstBad = firstBad || meetFirst;
    }
    // 원하는 상대 나이: 최소 ≤ 최대
    const ageMin = $("#pref_age_min", stepEl);
    const ageMax = $("#pref_age_max", stepEl);
    if (ageMin && ageMax && ageMin.value && ageMax.value && ageMin.checkValidity() && ageMax.checkValidity()
        && Number(ageMin.value) > Number(ageMax.value)) {
      showError(ageMax, "최대 나이가 최소 나이보다 작아요.");
      firstBad = firstBad || ageMax;
    }
    // 선택 항목 형식 검사 (키, 이메일)
    ["#height", "#email"].forEach((sel) => {
      const el = $(sel, stepEl);
      if (el && el.value && !el.checkValidity()) {
        showError(el, el.validationMessage);
        firstBad = firstBad || el;
      }
    });
    const extras = $("#extras", stepEl);
    if (extras && extras.files.length) {
      const files = Array.from(extras.files);
      if (files.length > MAX_EXTRAS) {
        showError(extras, `최대 ${MAX_EXTRAS}개까지 올릴 수 있어요.`);
        firstBad = firstBad || extras;
      } else if (files.some((f) => f.type.startsWith("video/") && f.size > MAX_VIDEO_BYTES)) {
        showError(extras, "영상은 10MB 이하만 올릴 수 있어요.");
        firstBad = firstBad || extras;
      }
    }
    if (firstBad) {
      firstBad.closest(".field").scrollIntoView({ block: "center" });
      firstBad.focus({ preventScroll: true });
    }
    return !firstBad;
  }

  $$("#apply-form input, #apply-form select, #apply-form textarea").forEach((el) => {
    el.addEventListener("input", () => clearError(el));
    el.addEventListener("change", () => clearError(el));
  });

  // ---------- 단계 이동 ----------
  const form = $("#apply-form");
  const steps = $$(".step", form);
  const stepperItems = $$(".stepper li");

  function goTo(n) {
    steps.forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
    stepperItems.forEach((li) => {
      const k = Number(li.dataset.step);
      if (k === n) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
      li.classList.toggle("is-done", k < n);
    });
    $("#apply").scrollIntoView({ block: "start" });
    const target = steps.find((s) => Number(s.dataset.step) === n);
    const focusable = n === 3 ? target : $("input, select, textarea", target);
    if (focusable) focusable.focus({ preventScroll: true });
  }

  $("[data-next]", form).addEventListener("click", () => {
    if (validateStep(steps[0])) goTo(2);
  });
  $("[data-prev]", form).addEventListener("click", () => goTo(1));

  // ---------- 이미지 줄이기 ----------
  function resizeImage(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.85);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
  }

  async function upload(id, name, file) {
    const isVideo = file.type.startsWith("video/");
    const body = isVideo ? file : await resizeImage(file);
    const ext = isVideo ? (file.type === "video/quicktime" ? "mov" : "mp4") : "jpg";
    const path = `${id}/${name}.${ext}`;
    const { error } = await db.storage.from("photos").upload(path, body, {
      contentType: isVideo ? file.type : "image/jpeg",
      upsert: false,
    });
    if (error) throw new Error("사진을 올리지 못했어요. 파일 크기와 형식을 확인하고 다시 시도해 주세요.");
    return path;
  }

  // ---------- 제출 ----------
  const submitBtn = $("#submit-btn");
  const submitError = $("#submit-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateStep(steps[1])) return;
    if (!validateStep(steps[0])) { goTo(1); return; }
    if (!configured) {
      submitError.textContent = "저장소가 아직 연결되지 않아 제출할 수 없어요. 운영자에게 알려 주세요.";
      submitError.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "제출하는 중…";
    submitError.hidden = true;

    try {
      const id = crypto.randomUUID();
      const fd = new FormData(form);
      const photoPath = await upload(id, "main", photoInput.files[0]);
      const extraFiles = Array.from($("#extras").files).slice(0, MAX_EXTRAS);
      const extraPaths = [];
      for (let i = 0; i < extraFiles.length; i++) {
        extraPaths.push(await upload(id, `extra-${i + 1}`, extraFiles[i]));
      }

      const resume = {
        id,
        nickname: fd.get("nickname"),
        intro: fd.get("intro"),
        gender: fd.get("gender"),
        age: fd.get("age"),
        height: fd.get("height") || "",
        region: fd.get("region"),
        district: fd.get("district") || "",
        job: fd.get("job") || "",
        mbti: fd.get("mbti") || "",
        photo_path: photoPath,
        extra_photo_paths: extraPaths,
        weekend: fd.get("weekend") || "",
        keywords: fd.getAll("keywords"),
        good_match: fd.get("good_match"),
        bad_match: fd.get("bad_match"),
        meet_regions: fd.getAll("meet_regions"),
        pref_age_min: fd.get("pref_age_min"),
        pref_age_max: fd.get("pref_age_max"),
      };
      const contact = {
        // 전화번호처럼 숫자·하이픈·공백만 있으면 숫자만 남겨요 (카카오톡 ID는 그대로)
        contact: /^[0-9\-\s]+$/.test(fd.get("contact").trim()) ? fd.get("contact").replace(/\D/g, "") : fd.get("contact"),
        email: fd.get("email") || "",
        is_adult: $("#is_adult").checked,
        privacy_agreed: $("#privacy_agreed").checked,
      };

      const { error } = await db.rpc("submit_application", { p_resume: resume, p_contact: contact });
      if (error) throw new Error(error.message || "제출하지 못했어요. 잠시 후 다시 시도해 주세요.");

      resetForm();
      goTo(3);
    } catch (err) {
      submitError.textContent = err.message;
      submitError.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "이력서 제출하기";
    }
  });

  // ---------- 임시 저장 ----------
  // 이 브라우저에만 저장돼요. 사진·연락처·동의 항목은 저장하지 않아요.
  const DRAFT_KEY = "teacher-dating-draft-v1";
  const DRAFT_SKIP = new Set(["contact", "email", "is_adult", "privacy_agreed"]);
  const draftNotice = $("#draft-notice");

  function draftFields() {
    return $$("input, select, textarea", form).filter((el) =>
      el.name && el.type !== "file" && !DRAFT_SKIP.has(el.name));
  }

  function collectDraft() {
    const data = {};
    draftFields().forEach((el) => {
      if (el.type === "checkbox") {
        if (!data[el.name]) data[el.name] = [];
        if (el.checked) data[el.name].push(el.value);
      } else if (el.type === "radio") {
        if (el.checked) data[el.name] = el.value;
      } else {
        data[el.name] = el.value;
      }
    });
    return data;
  }

  function hasContent(data) {
    return Object.values(data).some((v) => (Array.isArray(v) ? v.length : String(v).trim()));
  }

  let saveTimer = null;
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const data = collectDraft();
        if (hasContent(data)) localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
        else localStorage.removeItem(DRAFT_KEY);
      } catch (_) { /* 저장이 막힌 브라우저면 조용히 넘어가요 */ }
    }, 400);
  }

  function clearDraft() {
    clearTimeout(saveTimer);
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
  }

  function setValue(name, value) {
    const els = $$(`[name="${name}"]`, form);
    els.forEach((el) => {
      if (el.type === "checkbox") el.checked = Array.isArray(value) && value.includes(el.value);
      else if (el.type === "radio") el.checked = el.value === value;
      else el.value = value;
    });
  }

  function restoreDraft() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (_) { data = null; }
    if (!data || typeof data !== "object" || !hasContent(data)) return;
    // 지역을 먼저 넣어야 구/시·군 목록이 생겨요
    if (data.region) {
      regionSel.value = data.region;
      regionSel.dispatchEvent(new Event("change"));
    }
    Object.keys(data).forEach((name) => {
      if (name === "region" || DRAFT_SKIP.has(name)) return;
      setValue(name, data[name]);
    });
    draftNotice.hidden = false;
  }

  function resetForm() {
    clearDraft();
    form.reset();
    preview.hidden = true;
    districtField.hidden = true;
    districtSel.required = false;
    $$(".field-error", form).forEach((n) => n.remove());
    $$(".invalid", form).forEach((n) => n.classList.remove("invalid"));
    draftNotice.hidden = true;
  }

  form.addEventListener("input", saveDraft);
  form.addEventListener("change", saveDraft);
  $("#draft-clear").addEventListener("click", () => {
    resetForm();
    goTo(1);
  });
  restoreDraft();

  // ---------- 피드백 ----------
  const fbForm = $("#feedback-form");
  const fbStatus = $("#fb-status");
  fbForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = $("#fb-body").value.trim();
    if (!body) { fbStatus.textContent = "피드백 내용을 적어 주세요."; $("#fb-body").focus(); return; }
    if (!configured) { fbStatus.textContent = "저장소가 아직 연결되지 않았어요."; return; }
    const kind = (new FormData(fbForm).get("kind")) || "";
    const btn = $("button", fbForm);
    btn.disabled = true;
    const { error } = await db.rpc("submit_feedback", { p_kind: kind, p_body: body });
    btn.disabled = false;
    if (error) { fbStatus.textContent = "보내지 못했어요. 잠시 후 다시 시도해 주세요."; return; }
    fbForm.reset();
    fbStatus.textContent = "피드백을 보냈어요. 고마워요!";
  });
})();
