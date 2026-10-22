(function () {
  const kind = document.body.dataset.kind === "kids" ? "kids" : "adult";
  const FULL_TEXT = "Kids class is full right now. Email dits+bjj@mail.grokbot.com to ask about the next opening.";
  const form = document.getElementById("waiverForm");
  const note = document.getElementById("formNote");
  const submitBtn = document.getElementById("submitBtn");
  const closed = document.getElementById("closedNote");
  const fullNote = document.getElementById("fullNote");
  let open = false;
  let full = false;

  function pacificToday() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  function ageYears(dob, today) {
    const born = dob.split("-").map(Number);
    const now = today.split("-").map(Number);
    if (born.length !== 3 || born.some((n) => !n && n !== 0)) return null;
    let age = now[0] - born[0];
    if (now[1] < born[1] || (now[1] === born[1] && now[2] < born[2])) age -= 1;
    return age;
  }

  function say(message) {
    if (!note) return;
    note.textContent = message || "";
  }

  function applyGate() {
    const blocked = kind === "kids" && open && full;
    const canSubmit = open && !blocked;
    if (submitBtn) {
      submitBtn.disabled = !canSubmit;
      submitBtn.hidden = blocked;
    }
    if (closed) closed.hidden = open || blocked;
    if (fullNote) fullNote.hidden = !blocked;
  }

  function setOpen(enabled) {
    open = enabled === true;
    applyGate();
  }

  const signedOn = document.getElementById("signedOn");
  if (signedOn) signedOn.value = pacificToday();

  function sizePad(canvas) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const ratio = window.devicePixelRatio || 1;
    const nextW = Math.round(width * ratio);
    const nextH = Math.round(height * ratio);
    if (canvas.width === nextW && canvas.height === nextH) return;
    const ink = canvas.dataset.ink === "1";
    const snapshot = ink ? canvas.toDataURL("image/png") : "";
    canvas.width = nextW;
    canvas.height = nextH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (snapshot) {
      const img = new Image();
      img.onload = function () {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = snapshot;
    }
  }

  function bindPad(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    sizePad(canvas);
    let drawing = false;
    function point(event) {
      const rect = canvas.getBoundingClientRect();
      const src = event.touches ? event.touches[0] : event;
      return {
        x: ((src.clientX - rect.left) / rect.width) * canvas.width,
        y: ((src.clientY - rect.top) / rect.height) * canvas.height,
      };
    }
    function down(event) {
      event.preventDefault();
      drawing = true;
      const p = point(event);
      ctx.strokeStyle = "#1c1917";
      ctx.lineWidth = Math.max(2, (window.devicePixelRatio || 1) * 2);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
    function move(event) {
      if (!drawing) return;
      event.preventDefault();
      const p = point(event);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      canvas.dataset.ink = "1";
    }
    function up() {
      drawing = false;
    }
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    canvas.addEventListener("pointerleave", up);
  }

  function hasInk(canvas) {
    return !!(canvas && canvas.dataset.ink === "1");
  }

  function clearPad(canvas) {
    if (!canvas) return;
    canvas.dataset.ink = "0";
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  document.querySelectorAll("[data-clear]").forEach((btn) => {
    btn.addEventListener("click", () => clearPad(document.getElementById(btn.dataset.clear)));
  });

  const studentPad = document.getElementById("signaturePad");
  const parentPad = document.getElementById("parentPad");
  bindPad(studentPad);
  bindPad(parentPad);
  window.addEventListener("resize", () => {
    sizePad(studentPad);
    if (parentPad && !parentPad.closest("[hidden]")) sizePad(parentPad);
  });

  const dob = document.getElementById("dob");
  const minor = document.getElementById("minorFields");
  const ageNote = document.getElementById("ageNote");
  const potty = document.getElementById("pottyNote");

  function refreshAge() {
    const today = pacificToday();
    const age = dob && dob.value ? ageYears(dob.value, today) : null;
    if (kind === "adult" && minor) {
      const needsParent = age !== null && age < 18;
      minor.hidden = !needsParent;
      minor.querySelectorAll("input, canvas").forEach((el) => {
        if (el.dataset.alwaysOptional === "1") return;
        if (el.tagName === "INPUT") el.required = needsParent;
      });
      if (needsParent && parentPad) sizePad(parentPad);
      if (ageNote) {
        ageNote.hidden = !(age !== null && age < 11);
        ageNote.textContent = age !== null && age < 11
          ? "This enrollment is for ages 11 and up. Younger students use the kids form."
          : "";
      }
    }
    if (kind === "kids" && potty) {
      const show = age !== null && age >= 3 && age <= 6;
      potty.hidden = !show;
    }
  }

  if (dob) dob.addEventListener("change", refreshAge);

  Promise.all([
    fetch("/waiver-config.json", { cache: "no-store", credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : { waiverSubmissionsEnabled: false }))
      .catch(() => ({ waiverSubmissionsEnabled: false })),
    kind === "kids"
      ? fetch("/api/public/kids-enrollment", { cache: "no-store", credentials: "same-origin" })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null)
      : Promise.resolve(null),
  ]).then(([data, enrollment]) => {
    full = !!(enrollment && enrollment.full === true);
    setOpen(data && data.waiverSubmissionsEnabled === true);
  });

  document.getElementById("printBtn").addEventListener("click", () => window.print());

  function value(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function goals() {
    return [...form.querySelectorAll('input[name="goals"]:checked')].map((box) => box.value);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    say("");
    if (kind === "kids" && open && full) {
      say(FULL_TEXT);
      return;
    }
    if (!open) {
      say("Do not submit yet. Enrollment is not open.");
      return;
    }
    const today = pacificToday();
    const age = ageYears(value("dob"), today);
    if (kind === "adult" && age !== null && age < 11) {
      say("This enrollment is for ages 11 and up.");
      return;
    }
    if (kind === "adult" && age !== null && age < 18 && !hasInk(parentPad)) {
      say("A parent or guardian signature is required for students under 18.");
      return;
    }
    if (!hasInk(studentPad)) {
      say("Draw a signature before submitting.");
      return;
    }
    if (!form.reportValidity()) return;
    const body = {
      kind: kind,
      participantName: value("participantName"),
      address: value("address"),
      email: value("email"),
      phone: value("phone"),
      dob: value("dob"),
      parentName: value("parentName"),
      goals: goals(),
      emergencyName: value("emergencyName"),
      emergencyPhone: value("emergencyPhone"),
      injuries: value("injuries"),
      typedName: value("typedName"),
      printName: value("printName"),
      signature: studentPad.toDataURL("image/png"),
      parentTypedName: value("parentTypedName"),
      parentPrintName: value("parentPrintName"),
      parentSignature: parentPad && hasInk(parentPad) ? parentPad.toDataURL("image/png") : "",
    };
    submitBtn.disabled = true;
    fetch("/api/public/waivers", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (payload && payload.full) {
            full = true;
            applyGate();
          }
          throw new Error(payload.error || "Enrollment is not open.");
        }
        form.hidden = true;
        say("Enrollment saved. The church office has your form.");
      })
      .catch((err) => {
        applyGate();
        say(err.message || "Enrollment could not be saved.");
      });
  });
})();
