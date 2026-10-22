(function () {
  const kind = document.body.dataset.kind === "kids" ? "kids" : "adult";
  const FULL_TEXT = "Kids class is full right now. Email dits+bjj@mail.grokbot.com to ask about the next opening.";
  const form = document.getElementById("waiverForm");
  const note = document.getElementById("formNote");
  const submitBtn = document.getElementById("submitBtn");
  const closed = document.getElementById("closedNote");
  const fullNote = document.getElementById("fullNote");
  const waitlistBox = document.getElementById("waitlistBox");
  const waitlistForm = document.getElementById("waitlistForm");
  const waitlistNote = document.getElementById("waitlistNote");
  const waitlistDone = document.getElementById("waitlistDone");
  let open = false;
  let full = false;
  let waitlistOn = false;
  let serverFull = false;
  let serverWaitlist = false;

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
    const showWaitlist = kind === "kids" && full && waitlistOn;
    const showEmailFull = kind === "kids" && open && full && !waitlistOn;
    const canSubmit = open && !(kind === "kids" && full);
    if (submitBtn) {
      submitBtn.disabled = !canSubmit;
      submitBtn.hidden = kind === "kids" && full && (open || waitlistOn);
    }
    if (closed) closed.hidden = open || showWaitlist;
    if (fullNote) fullNote.hidden = !showEmailFull;
    if (waitlistBox) waitlistBox.hidden = !showWaitlist;
    paintDemoStates();
  }

  function paintDemoStates() {
    const box = document.getElementById("bjj-demo-states");
    if (!box) return;
    const openBtn = box.querySelector('[data-demo-state="open"]');
    const fullBtn = box.querySelector('[data-demo-state="full"]');
    if (openBtn) openBtn.setAttribute("aria-pressed", full ? "false" : "true");
    if (fullBtn) fullBtn.setAttribute("aria-pressed", full ? "true" : "false");
  }

  function mountDemoStates(enrollment) {
    if (!window.BJJ_BASE || kind !== "kids" || document.getElementById("bjj-demo-states")) return;
    const cap = enrollment && Number(enrollment.cap);
    const enrolled = enrollment && Number(enrollment.enrolled);
    const count = Number.isFinite(cap) && Number.isFinite(enrolled) ? enrolled + " of " + cap + " enrolled." : "";
    const style = document.createElement("style");
    style.id = "bjj-demo-states-style";
    style.textContent = [
      "#bjj-demo-states{position:sticky;top:4.5rem;z-index:9999;margin:0 0 16px;padding:12px;background:#ffe14a;color:#1c1917;border:4px solid #9b2a12}",
      "#bjj-demo-states p{margin:0 0 8px}",
      "#bjj-demo-states .row{display:flex;flex-wrap:wrap;gap:8px}",
      "#bjj-demo-states button{min-height:44px;min-width:44px;padding:8px 14px;border-radius:999px;font:inherit;font-weight:700;cursor:pointer}",
      '#bjj-demo-states button[aria-pressed="true"]{background:#9b2a12;color:#fff7ed;border:2px solid #9b2a12}',
      '#bjj-demo-states button[aria-pressed="false"]{background:#fff7ed;color:#1c1917;border:2px solid #9b2a12}'
    ].join("");
    document.head.appendChild(style);
    const box = document.createElement("div");
    box.id = "bjj-demo-states";
    box.className = "no-print";
    box.innerHTML = '<p><strong>Demo preview states.</strong> ' + count + "</p>"
      + '<div class="row"><button type="button" data-demo-state="open">Spots open</button>'
      + '<button type="button" data-demo-state="full">Class full, waitlist</button></div>'
      + '<p id="bjjDemoStateNote"></p>';
    const main = document.getElementById("main");
    if (main) main.insertBefore(box, main.firstChild);
    else document.body.insertBefore(box, document.body.firstChild);
    box.querySelector('[data-demo-state="open"]').addEventListener("click", function () {
      full = false;
      applyGate();
      const note = document.getElementById("bjjDemoStateNote");
      if (serverFull) {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.hidden = false;
        }
        say("Preview of the enrollment form. Saving stays off while the class is full.");
        if (note) note.textContent = "Preview of the enrollment form. Saving stays off while the class is full.";
      } else if (note) {
        note.textContent = "The enrollment form is open. " + count;
        say("");
      }
    });
    box.querySelector('[data-demo-state="full"]').addEventListener("click", function () {
      full = true;
      waitlistOn = serverWaitlist;
      applyGate();
      const note = document.getElementById("bjjDemoStateNote");
      say("");
      if (!serverFull) {
        const submit = document.getElementById("waitlistSubmit");
        if (submit) submit.disabled = true;
        const message = "Preview of the waitlist. Joining stays off while a spot is open.";
        waitSay(message);
        if (note) note.textContent = message;
      } else if (note) {
        note.textContent = "The class is full. The waitlist below is split into 3–6 Mighty Mites and 7–10 Pee Wees. Enter an age to see which list a child joins.";
        waitSay("");
      }
    });
    paintDemoStates();
    const note = document.getElementById("bjjDemoStateNote");
    if (note && serverFull && serverWaitlist) {
      note.textContent = "The class is full. The waitlist below is split into 3–6 Mighty Mites and 7–10 Pee Wees. Enter an age to see which list a child joins.";
    }
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
    serverFull = !!(enrollment && enrollment.full === true);
    serverWaitlist = !!(enrollment && enrollment.waitlistEnabled === true);
    full = serverFull;
    waitlistOn = serverWaitlist;
    const fileOn = !!(data && data.waiverSubmissionsEnabled === true);
    const apiOn = !!(enrollment && enrollment.submissionsEnabled === true);
    setOpen(fileOn || apiOn);
    mountDemoStates(enrollment);
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
    if (kind === "kids" && full && (open || waitlistOn)) {
      say(waitlistOn ? "Kids class is full right now. Join the waitlist and we'll reach out when a spot opens." : FULL_TEXT);
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

  function waitValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function waitSay(message) {
    if (!waitlistNote) return;
    waitlistNote.textContent = message || "";
  }

  function digits(value) {
    return (value.match(/\d/g) || []).length;
  }

  function derivedWaitGroup() {
    const ageText = waitValue("waitAge");
    const dob = waitValue("waitDob");
    let age = null;
    if (ageText) {
      const typed = Number(ageText);
      if (Number.isInteger(typed)) age = typed;
    }
    if (dob) {
      const fromDob = ageYears(dob, pacificToday());
      if (fromDob !== null && (age === null || age === fromDob)) age = fromDob;
      if (fromDob !== null && age !== null && age !== fromDob) return null;
    }
    if (age === null || age < 3 || age > 10) return null;
    return age <= 6 ? "mite" : "upper";
  }

  function showWaitGroup() {
    const line = document.getElementById("waitGroupLine");
    const select = document.getElementById("waitAgeGroup");
    if (!line || !select) return;
    const group = derivedWaitGroup();
    if (!group) {
      line.textContent = "Enter an age or date of birth. The age group comes from that.";
      if (select.value && !derivedWaitGroup()) select.value = "";
      return;
    }
    const label = group === "mite" ? "3–6 Mighty Mites" : "7–10 Pee Wees";
    line.textContent = "From this age, this child joins the " + label + " waitlist.";
    select.value = group;
  }

  ["waitAge", "waitDob", "waitAgeGroup"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", showWaitGroup);
    el.addEventListener("change", showWaitGroup);
  });

  if (waitlistForm) {
    waitlistForm.addEventListener("submit", (event) => {
      event.preventDefault();
      waitSay("");
      const parentName = waitValue("waitParent");
      const email = waitValue("waitEmail");
      const phone = waitValue("waitPhone");
      const childName = waitValue("waitChild");
      const ageText = waitValue("waitAge");
      const dob = waitValue("waitDob");
      const ageGroup = waitValue("waitAgeGroup");
      const noteText = waitValue("waitNote");
      if (parentName.length < 2) {
        waitSay("Enter the parent or guardian name.");
        return;
      }
      if (!email.includes("@")) {
        waitSay("Enter an email address.");
        return;
      }
      if (digits(phone) < 7) {
        waitSay("Enter a phone number.");
        return;
      }
      if (childName.length < 2) {
        waitSay("Enter the child's first name.");
        return;
      }
      if (!ageText && !dob) {
        waitSay("Enter the child's age or date of birth.");
        return;
      }
      let age = null;
      if (ageText) {
        age = Number(ageText);
        if (!Number.isInteger(age)) {
          waitSay("Enter the child's age.");
          return;
        }
      }
      if (dob) {
        const fromDob = ageYears(dob, pacificToday());
        if (fromDob === null) {
          waitSay("Enter a date of birth.");
          return;
        }
        if (age !== null && age !== fromDob) {
          waitSay("The age and date of birth do not match.");
          return;
        }
        if (age === null) age = fromDob;
      }
      if (age < 3 || age > 10) {
        waitSay("The kids class is for ages 3–10.");
        return;
      }
      const expected = age <= 6 ? "mite" : "upper";
      if (ageGroup !== expected) {
        waitSay("Choose the age group that matches the child's age.");
        return;
      }
      const confirmGroup = document.getElementById("waitConfirmGroup");
      if (!confirmGroup || !confirmGroup.checked) {
        waitSay("Confirm the age group.");
        return;
      }
      const submit = document.getElementById("waitlistSubmit");
      if (submit) submit.disabled = true;
      const body = {
        parentName: parentName,
        email: email,
        phone: phone,
        childName: childName,
        ageGroup: ageGroup,
        confirmAgeGroup: true,
        note: noteText,
      };
      if (ageText) body.age = age;
      if (dob) body.dob = dob;
      fetch("/api/public/waitlist", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          const payload = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(payload.error || "The waitlist is not open.");
          waitlistForm.hidden = true;
          if (waitlistDone) {
            waitlistDone.hidden = false;
            const place = payload.position ? "number " + payload.position + " on the " : "on the ";
            const label = payload.ageGroupLabel || "kids";
            waitlistDone.textContent = "You're " + place + label + " waitlist.";
          }
        })
        .catch((err) => {
          if (submit) submit.disabled = false;
          waitSay(err.message || "The waitlist could not be joined.");
        });
    });
  }
})();
