/*
 * Varmeflyt prototype — simulated data and interactions.
 *
 * Every record below is fictional demo data. Nothing here persists, synchronises
 * or reaches a server: readiness, completion and the assistant are staged so the
 * screens can be evaluated with technicians. See AGENTS.md.
 */

const orders = [
  {
    id: "1048",
    customer: "Anne Lise Nordby",
    address: "Granstubben 14, Lørenskog",
    fullAddress: "Granstubben 14, 1470 Lørenskog",
    type: "Service",
    tone: "blue",
    time: "08:30",
    status: "Pågår",
    sync: "Synkronisert",
    today: true,
    contact: { name: "Anne Lise Nordby", phone: "41 23 45 67" },
    jobType: { name: "Service", detail: "Årsservice" },
    device: { name: "Mitsubishi Kaiteki 6600", serial: "" },
    checklist: {
      label: "Årsservice",
      items: [
        { label: "Rengjør filtre", detail: "Utført kl. 09:02", done: true, required: true },
        { label: "Kontroller temperatur", detail: "Utluft 42 °C", done: true, required: true },
        { label: "Kontroller drenering", detail: "Ingen avvik", done: true, required: true },
        { label: "Ta bilde av innedel", detail: "Anbefalt", done: false, required: false }
      ]
    },
    readiness: [
      { key: "work", label: "Arbeid registrert", detail: "Utført i dag kl. 09:18", state: "done" },
      { key: "checklist", label: "Sjekkliste", detail: "3 av 3 påkrevde punkt", state: "done" },
      { key: "serial", label: "Serienummer mangler", detail: "Påkrevd for installert enhet", state: "missing", action: "Fyll ut" },
      { key: "signature", label: "Kundesignatur", detail: "Signert av Anne Lise Nordby", state: "done" }
    ],
    activity: [
      { title: "Kari startet besøket", detail: "I dag kl. 08:34" },
      { title: "Ordren ble synkronisert", detail: "I dag kl. 08:31" },
      { title: "Ola planla besøket", detail: "I går kl. 14:12" }
    ]
  },
  {
    id: "1051",
    customer: "Martin Solheim",
    address: "Fjellhamarveien 62, Fjellhamar",
    fullAddress: "Fjellhamarveien 62, 1472 Fjellhamar",
    type: "Montering",
    tone: "purple",
    time: "10:30",
    status: "Planlagt",
    sync: "Synkronisert",
    today: true,
    contact: { name: "Martin Solheim", phone: "92 08 41 15" },
    jobType: { name: "Montering", detail: "Ferdigstille installasjon" },
    device: { name: "Panasonic HZ25XKE", serial: "" },
    checklist: {
      label: "Montering",
      items: [
        { label: "Monter innedel", detail: "Ikke startet", done: false, required: true },
        { label: "Monter utedel", detail: "Ikke startet", done: false, required: true },
        { label: "Trykktest og lekkasjekontroll", detail: "Ikke startet", done: false, required: true },
        { label: "Overlevering til kunde", detail: "Ikke startet", done: false, required: true }
      ]
    },
    readiness: [
      { key: "work", label: "Arbeid registrert", detail: "Besøket er ikke startet", state: "pending" },
      { key: "checklist", label: "Sjekkliste", detail: "0 av 4 påkrevde punkt", state: "pending" },
      { key: "serial", label: "Serienummer", detail: "Registreres når enheten er montert", state: "pending" },
      { key: "signature", label: "Kundesignatur", detail: "Hentes ved overlevering", state: "pending" }
    ],
    activity: [
      { title: "Ola planla besøket", detail: "I går kl. 14:20" }
    ]
  },
  {
    id: "1054",
    customer: "Borettslaget Furulia",
    address: "Furuliveien 8B, Rælingen",
    fullAddress: "Furuliveien 8B, 2005 Rælingen",
    type: "Feilsøking",
    tone: "amber",
    time: "13:00",
    status: "Planlagt",
    sync: "Synkronisert",
    today: true,
    contact: { name: "Tore Aas, vaktmester", phone: "95 11 27 340" },
    jobType: { name: "Feilsøking", detail: "Ujevn varme" },
    device: { name: "Daikin Perfera 40", serial: "DP40-2211884" },
    checklist: {
      label: "Feilsøking",
      items: [
        { label: "Registrer feilbeskrivelse", detail: "Ikke startet", done: false, required: true },
        { label: "Mål temperatur og trykk", detail: "Ikke startet", done: false, required: true },
        { label: "Beskriv tiltak", detail: "Ikke startet", done: false, required: true }
      ]
    },
    readiness: [
      { key: "work", label: "Arbeid registrert", detail: "Besøket er ikke startet", state: "pending" },
      { key: "checklist", label: "Sjekkliste", detail: "0 av 3 påkrevde punkt", state: "pending" },
      { key: "signature", label: "Kundesignatur", detail: "Hentes ved avslutning", state: "pending" }
    ],
    activity: [
      { title: "Ola planla besøket", detail: "I går kl. 11:05" },
      { title: "Melding mottatt fra kunde", detail: "I går kl. 09:48" }
    ]
  },
  {
    id: "1057",
    customer: "Erik Berg",
    address: "Vestbyveien 23, Sørumsand",
    fullAddress: "Vestbyveien 23, 1920 Sørumsand",
    type: "Befaring",
    tone: "slate",
    time: "15:00",
    status: "Planlagt",
    sync: "Synkronisert",
    today: true,
    contact: { name: "Erik Berg", phone: "48 22 60 91" },
    jobType: { name: "Befaring", detail: "Grunnlag for tilbud" },
    device: null,
    checklist: {
      label: "Befaring",
      items: [
        { label: "Mål rom og plassering", detail: "Ikke startet", done: false, required: true },
        { label: "Ta bilder av vegg og uteplass", detail: "Ikke startet", done: false, required: true }
      ]
    },
    readiness: [
      { key: "work", label: "Arbeid registrert", detail: "Besøket er ikke startet", state: "pending" },
      { key: "checklist", label: "Sjekkliste", detail: "0 av 2 påkrevde punkt", state: "pending" }
    ],
    activity: [
      { title: "Ola planla befaringen", detail: "Mandag kl. 08:55" }
    ]
  },
  {
    id: "1041",
    customer: "Ida Evensen",
    address: "Stasjonsveien 7, Strømmen",
    fullAddress: "Stasjonsveien 7, 2010 Strømmen",
    type: "Montering",
    tone: "purple",
    time: "I går",
    status: "Pågår",
    sync: "Krever oppfølging",
    followup: true,
    contact: { name: "Ida Evensen", phone: "99 41 07 62" },
    jobType: { name: "Montering", detail: "Luft-luft, én innedel" },
    device: { name: "Toshiba Shorai Edge 35", serial: "" },
    checklist: {
      label: "Montering",
      items: [
        { label: "Monter innedel", detail: "Utført i går kl. 13:10", done: true, required: true },
        { label: "Monter utedel", detail: "Utført i går kl. 14:02", done: true, required: true },
        { label: "Trykktest og lekkasjekontroll", detail: "Ingen avvik", done: true, required: true },
        { label: "Overlevering til kunde", detail: "Utført i går kl. 15:20", done: true, required: true }
      ]
    },
    readiness: [
      { key: "work", label: "Arbeid registrert", detail: "Utført i går kl. 15:20", state: "done" },
      { key: "checklist", label: "Sjekkliste", detail: "4 av 4 påkrevde punkt", state: "done" },
      { key: "serial", label: "Serienummer mangler", detail: "Påkrevd for installert enhet", state: "missing", action: "Fyll ut" },
      { key: "signature", label: "Kundesignatur", detail: "Signert av Ida Evensen", state: "done" }
    ],
    activity: [
      { title: "Ferdigmelding ble stoppet av kravkontrollen", detail: "I går kl. 15:22" },
      { title: "Kari fullførte sjekklisten", detail: "I går kl. 15:20" },
      { title: "Kari startet besøket", detail: "I går kl. 12:40" }
    ]
  },
  {
    id: "1036",
    customer: "Nordre Park AS",
    address: "Industriveien 4, Skedsmokorset",
    fullAddress: "Industriveien 4, 2020 Skedsmokorset",
    type: "Service",
    tone: "blue",
    time: "09.09",
    status: "Pågår",
    sync: "Krever oppfølging",
    followup: true,
    contact: { name: "Bjørn Five, driftsleder", phone: "91 60 33 18" },
    jobType: { name: "Service", detail: "Årsservice, væske-vann" },
    device: { name: "NIBE S1255", serial: "S1255-0093741" },
    checklist: {
      label: "Årsservice",
      items: [
        { label: "Kontroller kuldemediekrets", detail: "Ingen avvik", done: true, required: true },
        { label: "Kontroller sirkulasjonspumpe", detail: "Utført 09.09 kl. 10:40", done: true, required: true },
        { label: "Loggfør driftstrykk", detail: "2,1 bar", done: true, required: true }
      ]
    },
    readiness: [
      { key: "work", label: "Arbeid registrert", detail: "Utført 09.09 kl. 11:15", state: "done" },
      { key: "checklist", label: "Sjekkliste", detail: "3 av 3 påkrevde punkt", state: "done" },
      { key: "photo", label: "Bilde av utedel mangler", detail: "Kravet ble lagt til 10.09, etter at besøket ble utført", state: "missing", action: "Legg til", actionDemo: "Bildeopplasting er ikke med i prototypen." },
      { key: "signature", label: "Kundesignatur", detail: "Signert av Bjørn Five", state: "done" }
    ],
    activity: [
      { title: "Ferdigmeldingen ble avvist av serveren", detail: "09.09 kl. 11:16 · nytt krav på jobbtypen Service" },
      { title: "Kari fullførte besøket", detail: "09.09 kl. 11:15" },
      { title: "Kari startet besøket", detail: "09.09 kl. 09:30" }
    ]
  },
  {
    id: "1058",
    customer: "Sofie Dahl",
    address: "Åsenhagen 12, Lillestrøm",
    fullAddress: "Åsenhagen 12, 2013 Lillestrøm",
    type: "Service",
    tone: "blue",
    time: "14.09",
    status: "Planlagt",
    sync: "Synkronisert",
    contact: { name: "Sofie Dahl", phone: "46 85 12 07" },
    jobType: { name: "Service", detail: "Årsservice" },
    device: { name: "Mitsubishi Kirigamine 50", serial: "MK50-1904223" },
    checklist: {
      label: "Årsservice",
      items: [
        { label: "Rengjør filtre", detail: "Ikke startet", done: false, required: true },
        { label: "Kontroller temperatur", detail: "Ikke startet", done: false, required: true },
        { label: "Kontroller drenering", detail: "Ikke startet", done: false, required: true }
      ]
    },
    readiness: [
      { key: "work", label: "Arbeid registrert", detail: "Besøket er ikke startet", state: "pending" },
      { key: "checklist", label: "Sjekkliste", detail: "0 av 3 påkrevde punkt", state: "pending" },
      { key: "signature", label: "Kundesignatur", detail: "Hentes ved avslutning", state: "pending" }
    ],
    activity: [
      { title: "Ola planla besøket", detail: "I dag kl. 07:40" }
    ]
  },
  {
    id: "1060",
    customer: "Lillestrøm Bakeri",
    address: "Torvgata 9, Lillestrøm",
    fullAddress: "Torvgata 9, 2000 Lillestrøm",
    type: "Feilsøking",
    tone: "amber",
    time: "15.09",
    status: "Til fordeling",
    sync: "Synkronisert",
    contact: { name: "Hanne Rud", phone: "40 55 19 26" },
    jobType: { name: "Feilsøking", detail: "Kjølerom holder ikke temperatur" },
    device: { name: "Bitzer 4FES-3Y", serial: "4FES-880214" },
    checklist: {
      label: "Feilsøking",
      items: [
        { label: "Registrer feilbeskrivelse", detail: "Ikke startet", done: false, required: true },
        { label: "Mål temperatur og trykk", detail: "Ikke startet", done: false, required: true },
        { label: "Beskriv tiltak", detail: "Ikke startet", done: false, required: true }
      ]
    },
    readiness: [
      { key: "assignment", label: "Tekniker ikke tildelt", detail: "Ordren ligger til fordeling", state: "missing", action: "Fordel", actionDemo: "Fordeling gjøres i Planlegger, som ikke er med i prototypen." },
      { key: "work", label: "Arbeid registrert", detail: "Besøket er ikke startet", state: "pending" },
      { key: "checklist", label: "Sjekkliste", detail: "0 av 3 påkrevde punkt", state: "pending" }
    ],
    activity: [
      { title: "Ordren ble opprettet", detail: "I dag kl. 08:05" }
    ]
  }
];

const orderById = new Map(orders.map(order => [order.id, order]));

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let activeOrderId = "1048";
let toastTimer;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
}

function activeOrder() {
  return orderById.get(activeOrderId);
}

function switchView(view, filter) {
  if (view === "more") {
    showToast("Flere moduler: Kunder, Enheter, Planlegger og Rapporter");
    return;
  }
  if (!$("#view-" + view)) return;
  $$("[data-view-panel]").forEach(panel => panel.classList.toggle("is-visible", panel.dataset.viewPanel === view));
  $$(".nav-item[data-view], .bottom-nav [data-view]").forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  if (view === "ordrer") {
    renderOrders(filter || "all");
    $$("[data-order-filter]").forEach(chip => chip.classList.toggle("is-selected", chip.dataset.orderFilter === (filter || "all")));
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
  $("#main-content").focus({ preventScroll: true });
}

function renderOrders(filter = "all", query = "") {
  const normalized = query.toLocaleLowerCase("nb-NO");
  const filtered = orders.filter(order => {
    const matchesFilter = filter === "all" || (filter === "today" && order.today) || (filter === "followup" && order.followup);
    const haystack = `${order.id} ${order.customer} ${order.address} ${order.type}`.toLocaleLowerCase("nb-NO");
    return matchesFilter && haystack.includes(normalized);
  });
  $("#ordersTableBody").innerHTML = filtered.map(order => `
    <tr tabindex="0" data-order="${order.id}" aria-label="Åpne ordre ORD-${order.id} for ${escapeHtml(order.customer)}">
      <td><strong>ORD-${order.id}</strong><small>${escapeHtml(order.address)}</small></td>
      <td><strong>${escapeHtml(order.customer)}</strong></td>
      <td>${escapeHtml(order.type)}</td>
      <td>${escapeHtml(order.time)}</td>
      <td><span class="status-pill">${escapeHtml(order.status)}</span></td>
      <td><span class="sync-label ${order.followup ? "issue" : ""}">${order.followup ? "!" : "✓"} ${escapeHtml(order.sync)}</span></td>
      <td><button class="more-button" data-demo="Flere ordrevalg er ikke med i prototypen." aria-label="Flere valg for ORD-${order.id}">•••</button></td>
    </tr>`).join("") || `<tr><td colspan="7"><p class="search-hint">Ingen ordre passer med søket.</p></td></tr>`;
}

/* ---- Order drawer -------------------------------------------------------- */

const READINESS_ICON = { done: "✓", missing: "!", pending: "○" };

function serialSatisfied(order) {
  return Boolean(order.device && order.device.serial.trim().length >= 5);
}

function readinessFor(order) {
  return order.readiness.map(item => {
    if (item.key !== "serial" || !order.device) return item;
    if (!serialSatisfied(order)) return item;
    return { ...item, label: "Serienummer registrert", detail: order.device.serial.trim(), state: "done", action: undefined };
  });
}

function renderReadiness(order) {
  const items = readinessFor(order);
  const done = items.filter(item => item.state === "done").length;
  const outstanding = items.filter(item => item.state !== "done");
  const blocking = items.filter(item => item.state === "missing");
  const percent = items.length ? Math.round((done / items.length) * 100) : 0;

  $("#readinessList").innerHTML = items.map(item => `
    <li class="${item.state === "done" ? "is-done" : item.state === "missing" ? "is-missing" : "is-pending"}"${item.key === "serial" ? ' id="serialRequirement"' : ""}>
      <span aria-hidden="true">${READINESS_ICON[item.state]}</span>
      <span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span>
      ${item.action ? (item.key === "serial"
        ? `<button data-focus-serial>${escapeHtml(item.action)}</button>`
        : `<button data-demo="${escapeHtml(item.actionDemo || "Dette steget er ikke med i prototypen.")}">${escapeHtml(item.action)}</button>`) : ""}
    </li>`).join("");

  $("#progressValue").textContent = `${percent} %`;
  $("#progressBar").style.width = `${percent}%`;
  $("#progressHeading").textContent = outstanding.length === 0 ? "Klar til ferdigmelding"
    : blocking.length > 0 ? "Kan ikke ferdigmeldes ennå"
    : "Besøket er ikke fullført";
  $("#completionState").textContent = outstanding.length === 0 ? "Klar til ferdigmelding"
    : `${outstanding.length} ${outstanding.length === 1 ? "punkt" : "punkter"} mangler`;

  const button = $("#completeOrderButton");
  button.disabled = false;
  button.textContent = "Ferdigmeld besøket";
}

function renderChecklist(order) {
  const items = order.checklist.items;
  const requiredTotal = items.filter(item => item.required).length;
  const requiredDone = items.filter(item => item.required && item.done).length;
  const done = items.filter(item => item.done).length;

  $("#checklistTabCount").textContent = `${done}/${items.length}`;
  $("#checklistSummary").textContent = requiredDone === requiredTotal
    ? `${order.checklist.label} · alle påkrevde punkt utført`
    : `${order.checklist.label} · ${requiredDone} av ${requiredTotal} påkrevde punkt`;
  $("#checklistItems").innerHTML = items.map(item => `
    <label class="check-row">
      <input type="checkbox" ${item.done ? "checked" : ""} />
      <span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}${item.required ? "" : " · Anbefalt"}</small></span>
    </label>`).join("");
}

function renderDrawer(order) {
  $("#orderEyebrow").textContent = `ORD-${order.id} · ${order.type}`;
  $("#orderTitle").textContent = order.customer;
  $("#drawerAddress").textContent = order.fullAddress;

  const statusTag = $("#drawerStatus");
  statusTag.textContent = order.status;
  statusTag.className = `tag tag-${order.tone}`;

  const sync = $("#drawerSync");
  sync.className = `sync-label ${order.followup ? "issue" : ""}`;
  sync.innerHTML = `<span aria-hidden="true">${order.followup ? "!" : "✓"}</span> ${escapeHtml(order.sync)}`;

  const deviceSection = $("#deviceSection");
  deviceSection.hidden = !order.device;
  if (order.device) {
    $("#deviceName").textContent = order.device.name;
    $("#serialNumber").value = order.device.serial;
    const required = order.readiness.some(item => item.key === "serial");
    $("#serialRequiredMark").textContent = required ? "(må fylles ut)" : "(valgfritt)";
    $("#serialNumber").classList.remove("has-error");
  }

  $("#contactName").textContent = order.contact.name;
  $("#contactPhone").textContent = order.contact.phone;
  $("#contactPhone").href = `tel:+47${order.contact.phone.replace(/\s/g, "")}`;
  $("#jobTypeName").textContent = order.jobType.name;
  $("#jobTypeDetail").textContent = order.jobType.detail;

  $("#activityList").innerHTML = order.activity.map(entry => `
    <div><span class="activity-dot"></span><p><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(entry.detail)}</small></p></div>`).join("");

  renderChecklist(order);
  renderReadiness(order);

  $$("[data-order-tab]").forEach(tab => tab.setAttribute("aria-selected", String(tab.dataset.orderTab === "overview")));
  $$("[data-order-panel]").forEach(panel => panel.classList.toggle("is-visible", panel.dataset.orderPanel === "overview"));
}

function openOrder(id) {
  const order = orderById.get(id);
  if (!order) return;
  activeOrderId = id;
  renderDrawer(order);
  $("#orderDrawer").classList.add("is-open");
  $("#orderDrawer").setAttribute("aria-hidden", "false");
  $("#overlay").hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#orderDrawer [data-close-drawer]").focus(), 50);
}

function closeDrawers() {
  $$(".drawer").forEach(drawer => {
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
  });
  $("#overlay").hidden = true;
  document.body.style.overflow = "";
}

/* ---- Assistant ----------------------------------------------------------- */

function openAssistant(prompt) {
  $("#assistantDrawer").classList.add("is-open");
  $("#assistantDrawer").setAttribute("aria-hidden", "false");
  $("#overlay").hidden = false;
  document.body.style.overflow = "hidden";
  if (prompt) answerAssistant(prompt);
  else setTimeout(() => $("#assistantInput").focus(), 60);
}

function readinessAnswer() {
  const order = activeOrder();
  const outstanding = readinessFor(order).filter(item => item.state !== "done");
  if (outstanding.length === 0) {
    return `<p><strong>Besøket kan ferdigmeldes.</strong></p>
      <p>Kravkontrollen fant ingen punkter som mangler på ORD-${order.id}.</p>
      <p class="assistant-source">Kilde: aktivt oppsett og kravkontroll for ORD-${order.id}</p>`;
  }
  const blocking = outstanding.filter(item => item.state === "missing");
  const lead = blocking.length > 0
    ? `Kravkontrollen fant ${blocking.length === 1 ? "ett obligatorisk punkt" : `${blocking.length} obligatoriske punkter`}.`
    : "Besøket er ikke fullført ennå.";
  const rows = outstanding.map(item => `<div><span>${READINESS_ICON[item.state]}</span><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span></div>`).join("");
  const serialMissing = blocking.some(item => item.key === "serial");
  return `<p><strong>Besøket kan ikke ferdigmeldes ennå.</strong></p>
    <p>${lead}${serialMissing && order.device ? ` Serienummer mangler på ${escapeHtml(order.device.name)}.` : ""}</p>
    <div class="assistant-result">${rows}</div>
    ${serialMissing ? `<button class="assistant-action" data-assistant-action="serial">Gå til serienummer</button>` : ""}
    <p class="assistant-source">Kilde: aktivt oppsett og kravkontroll for ORD-${order.id}</p>`;
}

function assistantResponse(prompt) {
  const lower = prompt.toLocaleLowerCase("nb-NO");
  if (lower.includes("ferdigmelde")) return readinessAnswer();
  if (lower.includes("legger jeg til en enhet") || lower.includes("legg til en enhet")) {
    return `<p>Åpne adressen og velg <strong>Enheter</strong>. Trykk deretter <strong>Legg til enhet</strong>.</p>
      <p>Du kan registrere type, produsent, modell og serienummer med én gang, eller lagre og fortsette senere.</p>
      <button class="assistant-action" data-assistant-action="show-device">Vis meg</button>
      <p class="assistant-source">Kilde: Varmeflyt-hjelp · Registrere enhet</p>`;
  }
  if (lower.includes("enova") || lower.includes("søknadsnummer")) {
    return `<p><strong>Utkastet er validert.</strong> Ingenting er publisert ennå.</p>
      <div class="assistant-result">
        <div><span>✓</span><span>Felt: <strong>Enova-søknadsnummer</strong></span></div>
        <div><span>✓</span><span>Plassering: <strong>Ordre · Detaljer</strong></span></div>
        <div><span>✓</span><span>Synlig for: <strong>Montering</strong></span></div>
        <div><span>✓</span><span>Krav: <strong>før fakturering</strong></span></div>
        <div><span>✓</span><span>Kunderapport: <strong>ikke inkludert</strong></span></div>
        <div><span>✓</span><span>Eksisterende arbeid: <strong>3 åpne ordre berøres</strong></span></div>
      </div>
      <button class="assistant-action" data-assistant-action="preview-config">Forhåndsvis utkast</button>
      <p class="assistant-source">Kilde: aktivt oppsett · Utkast kan bare publiseres av administrator</p>`;
  }
  return `<p>Jeg fant ikke et sikkert svar i aktivt oppsett eller hjelpetekstene.</p><p>Prøv å nevne hvilken ordre, adresse eller handling det gjelder.</p>`;
}

function answerAssistant(prompt) {
  const conversation = $("#assistantConversation");
  $$(".suggestion, .assistant-welcome", conversation).forEach(item => item.remove());
  conversation.insertAdjacentHTML("beforeend", `<div class="message user"><p>${escapeHtml(prompt)}</p></div><div class="message assistant">${assistantResponse(prompt)}</div>`);
  conversation.scrollTop = conversation.scrollHeight;
}

/* ---- Search -------------------------------------------------------------- */

function openSearch() {
  const dialog = $("#searchDialog");
  if (!dialog.open) dialog.showModal();
  setTimeout(() => $("#globalSearchInput").focus(), 30);
}

function renderSearch(query) {
  const normalized = query.toLocaleLowerCase("nb-NO").trim();
  if (!normalized) {
    $("#searchResults").innerHTML = `<p class="search-hint">Søk etter kunde, adresse, ordre eller serienummer.</p>`;
    return;
  }
  const found = orders.filter(order => `${order.id} ${order.customer} ${order.address} ${order.type}`.toLocaleLowerCase("nb-NO").includes(normalized)).slice(0, 5);
  $("#searchResults").innerHTML = found.map(order => `<button type="button" class="search-result" data-order="${order.id}"><span>▤</span><span><strong>ORD-${order.id} · ${escapeHtml(order.customer)}</strong><small>${escapeHtml(order.address)}</small></span><span>›</span></button>`).join("") || `<p class="search-hint">Ingen treff på «${escapeHtml(query)}».</p>`;
}

/* ---- Static demo panels -------------------------------------------------- */

function fillDemoViews() {
  $("#agendaDemo").innerHTML = ["I dag · 11. sep", "I morgen · 12. sep", "Mandag · 14. sep", "Tirsdag · 15. sep"].map((day, index) => `<section class="agenda-column"><h2>${day}</h2>${orders.filter(order => index === 0 ? order.today : order.id.charCodeAt(3) % 3 === index - 1).slice(0,3).map(order => `<div class="agenda-item"><strong>${escapeHtml(order.time)} · ${escapeHtml(order.customer)}</strong><small>${escapeHtml(order.type)} · ${escapeHtml(order.address.split(",")[0])}</small></div>`).join("")}</section>`).join("");
  $("#customerList").innerHTML = [
    ["AN", "Anne Lise Nordby", "Granstubben 14 · 1 enhet", "Neste service 11.09.2027"],
    ["MS", "Martin Solheim", "Fjellhamarveien 62 · 1 enhet", "Montering pågår"],
    ["BF", "Borettslaget Furulia", "Furuliveien 8B · 12 enheter", "2 åpne ordre"],
    ["NP", "Nordre Park AS", "Industriveien 4 · 8 enheter", "Serviceavtale"]
  ].map(item => `<button class="generic-row" data-demo="Kunderegisteret er ikke med i prototypen."><span class="generic-row-icon">${item[0]}</span><span><strong>${item[1]}</strong><small>${item[2]}</small></span><span class="generic-row-meta">${item[3]} ›</span></button>`).join("");
  $("#deviceList").innerHTML = [
    ["MI", "Mitsubishi Kaiteki 6600", "Anne Lise Nordby · Luft-luft", "Service i dag"],
    ["TO", "Toshiba Shorai Edge 35", "Ida Evensen · Luft-luft", "Krever oppfølging"],
    ["PA", "Panasonic HZ25XKE", "Martin Solheim · Luft-luft", "Montering i dag"],
    ["NI", "NIBE S1255", "Nordre Park AS · Væske-vann", "Service om 24 dager"]
  ].map(item => `<button class="generic-row" data-demo="Enhetsregisteret er ikke med i prototypen."><span class="generic-row-icon">${item[0]}</span><span><strong>${item[1]}</strong><small>${item[2]}</small></span><span class="generic-row-meta">${item[3]} ›</span></button>`).join("");
  $("#plannerDemo").innerHTML = [
    `<div class="planner-row"><div class="planner-person">Tekniker</div>${[8,9,10,11,12,13,14,15,16].map(hour => `<div>${String(hour).padStart(2,"0")}:00</div>`).join("")}</div>`,
    `<div class="planner-row"><div class="planner-person"><span class="avatar">KH</span>Kari Hansen</div><div class="planner-block" style="grid-column:2/4">Service · Nordby</div><div></div><div class="planner-block" style="grid-column:5/7">Montering · Solheim</div><div class="planner-block" style="grid-column:7/9">Feilsøking · Furulia</div><div></div></div>`,
    `<div class="planner-row"><div class="planner-person"><span class="avatar">OL</span>Ola Lund</div><div></div><div class="planner-block" style="grid-column:3/6">Montering · Hauge</div><div></div><div></div><div class="planner-block" style="grid-column:8/10">Service · Nordre Park</div></div>`
  ].join("");
  $("#reportGrid").innerHTML = [
    ["Ferdigmeldt", "18", "+12 % fra forrige uke"],
    ["Førstegangs løst", "83 %", "15 av 18 ordre"],
    ["Krever oppfølging", "2", "Begge er tildelt"],
    ["Planlagt tid", "31,5 t", "4 teknikere"],
    ["Ikke fordelt", "3", "Neste uke"],
    ["Synkronisering", "99,8 %", "Siste sju dager"]
  ].map(item => `<article class="report-card"><strong>${item[0]}</strong><span class="metric">${item[1]}</span><small>${item[2]}</small></article>`).join("");
}

/* ---- Events -------------------------------------------------------------- */

document.addEventListener("click", event => {
  const demo = event.target.closest("[data-demo]");
  if (demo) {
    showToast(demo.dataset.demo);
    return;
  }

  const viewButton = event.target.closest("[data-view]");
  if (viewButton) switchView(viewButton.dataset.view, viewButton.dataset.filter);

  const orderTarget = event.target.closest("[data-order]");
  if (orderTarget) openOrder(orderTarget.dataset.order);

  const assistantPrompt = event.target.closest("[data-assistant-prompt]");
  if (assistantPrompt) openAssistant(assistantPrompt.dataset.assistantPrompt);
  if (event.target.closest("[data-open-assistant]")) openAssistant();
  if (event.target.closest("[data-close-assistant], [data-close-drawer]") || event.target === $("#overlay")) closeDrawers();

  const tab = event.target.closest("[data-order-tab]");
  if (tab) {
    $$("[data-order-tab]").forEach(item => item.setAttribute("aria-selected", String(item === tab)));
    $$("[data-order-panel]").forEach(panel => panel.classList.toggle("is-visible", panel.dataset.orderPanel === tab.dataset.orderTab));
  }

  if (event.target.closest("[data-focus-serial]")) {
    const input = $("#serialNumber");
    input.classList.add("has-error");
    input.focus();
  }

  const assistantAction = event.target.closest("[data-assistant-action]");
  if (assistantAction) {
    const action = assistantAction.dataset.assistantAction;
    if (action === "serial") {
      closeDrawers();
      setTimeout(() => { openOrder(activeOrderId); $("#serialNumber").classList.add("has-error"); setTimeout(() => $("#serialNumber").focus(), 80); }, 180);
    } else if (action === "show-device") {
      closeDrawers();
      switchView("enheter");
      showToast("Her finner du «Ny enhet» øverst på siden.");
    } else {
      showToast("Forhåndsvisningen er klar. Bare en administrator kan publisere endringen.");
    }
  }

  const chip = event.target.closest("[data-order-filter]");
  if (chip) {
    $$("[data-order-filter]").forEach(item => item.classList.toggle("is-selected", item === chip));
    renderOrders(chip.dataset.orderFilter, $("#orderSearch").value);
  }

  const sizeButton = event.target.closest("[data-font-size]");
  if (sizeButton) {
    const scales = { normal: 1, large: 1.125, xlarge: 1.25 };
    document.documentElement.style.setProperty("--font-scale", scales[sizeButton.dataset.fontSize]);
    $$("[data-font-size]").forEach(button => button.classList.toggle("is-selected", button === sizeButton));
    localStorage.setItem("varmeflyt-font-size", sizeButton.dataset.fontSize);
  }
});

$("#searchTrigger").addEventListener("click", openSearch);
$("#mobileSearch").addEventListener("click", openSearch);
$("#globalSearchInput").addEventListener("input", event => renderSearch(event.target.value));
$("#searchResults").addEventListener("click", event => {
  const result = event.target.closest("[data-order]");
  if (result) { $("#searchDialog").close(); openOrder(result.dataset.order); }
});
$("#orderSearch").addEventListener("input", event => {
  const activeFilter = $("[data-order-filter].is-selected")?.dataset.orderFilter || "all";
  renderOrders(activeFilter, event.target.value);
});

$("#profileButton").addEventListener("click", () => {
  const menu = $("#profileMenu");
  menu.hidden = !menu.hidden;
  $("#profileButton").setAttribute("aria-expanded", String(!menu.hidden));
});

$("#assistantForm").addEventListener("submit", event => {
  event.preventDefault();
  const input = $("#assistantInput");
  const value = input.value.trim();
  if (!value) return;
  answerAssistant(value);
  input.value = "";
});

$("#serialNumber").addEventListener("input", event => {
  const order = activeOrder();
  if (!order || !order.device) return;
  order.device.serial = event.target.value;
  event.target.classList.toggle("has-error", !serialSatisfied(order));
  renderReadiness(order);
});

$("#completeOrderButton").addEventListener("click", () => {
  const order = activeOrder();
  const outstanding = readinessFor(order).filter(item => item.state !== "done");
  if (outstanding.length > 0) {
    const blocking = outstanding.find(item => item.state === "missing");
    if (blocking && blocking.key === "serial") {
      $("#serialNumber").classList.add("has-error");
      $("#serialNumber").focus();
      showToast("Serienummer må fylles ut før besøket kan ferdigmeldes.");
      return;
    }
    showToast(`Besøket kan ikke ferdigmeldes: ${outstanding[0].label.toLocaleLowerCase("nb-NO")}.`);
    return;
  }
  order.status = "Ferdigmeldt";
  $("#completeOrderButton").textContent = "Besøket er ferdigmeldt";
  $("#completeOrderButton").disabled = true;
  $("#drawerStatus").textContent = "Ferdigmeldt";
  showToast("Besøket ble ferdigmeldt og lagt i synkroniseringskøen.");
});

$("#newButton").addEventListener("click", () => showToast("Velg hva du vil opprette: Ordre, kunde, adresse eller enhet."));
$("#syncStatusButton").addEventListener("click", () => showToast("Alle endringer er synkronisert. Sist kontrollert nå."));

document.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openSearch(); }
  if (event.key === "Escape") closeDrawers();
});

const savedSize = localStorage.getItem("varmeflyt-font-size") || "normal";
const savedButton = $(`[data-font-size="${savedSize}"]`);
if (savedButton) savedButton.click();
renderOrders();
fillDemoViews();
