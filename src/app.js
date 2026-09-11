const orders = [
  { id: "1048", customer: "Anne Lise Nordby", address: "Granstubben 14, Lørenskog", type: "Service", time: "08:30", status: "Planlagt", sync: "Synkronisert", today: true },
  { id: "1051", customer: "Martin Solheim", address: "Fjellhamarveien 62, Fjellhamar", type: "Montering", time: "10:30", status: "Planlagt", sync: "Synkronisert", today: true },
  { id: "1054", customer: "Borettslaget Furulia", address: "Furuliveien 8B, Rælingen", type: "Feilsøking", time: "13:00", status: "Planlagt", sync: "Synkronisert", today: true },
  { id: "1057", customer: "Erik Berg", address: "Vestbyveien 23, Sørumsand", type: "Befaring", time: "15:00", status: "Planlagt", sync: "Synkronisert", today: true },
  { id: "1041", customer: "Ida Evensen", address: "Stasjonsveien 7, Strømmen", type: "Montering", time: "I går", status: "Pågår", sync: "Krever oppfølging", followup: true },
  { id: "1036", customer: "Nordre Park AS", address: "Industriveien 4, Skedsmokorset", type: "Service", time: "09.09", status: "Pågår", sync: "Krever oppfølging", followup: true },
  { id: "1058", customer: "Sofie Dahl", address: "Åsenhagen 12, Lillestrøm", type: "Service", time: "14.09", status: "Planlagt", sync: "Synkronisert" },
  { id: "1060", customer: "Lillestrøm Bakeri", address: "Torvgata 9, Lillestrøm", type: "Feilsøking", time: "15.09", status: "Til fordeling", sync: "Synkronisert" }
];

const orderDetails = {
  "1048": { customer: "Anne Lise Nordby", type: "Service", address: "Granstubben 14, 1470 Lørenskog" },
  "1051": { customer: "Martin Solheim", type: "Montering", address: "Fjellhamarveien 62, 1472 Fjellhamar" },
  "1054": { customer: "Borettslaget Furulia", type: "Feilsøking", address: "Furuliveien 8B, 2005 Rælingen" },
  "1057": { customer: "Erik Berg", type: "Befaring", address: "Vestbyveien 23, 1920 Sørumsand" },
  "1041": { customer: "Ida Evensen", type: "Montering", address: "Stasjonsveien 7, 2010 Strømmen" },
  "1036": { customer: "Nordre Park AS", type: "Service", address: "Industriveien 4, 2020 Skedsmokorset" }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let activeOrderId = "1048";
let toastTimer;

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
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
    <tr tabindex="0" data-order="${order.id}" aria-label="Åpne ordre ORD-${order.id} for ${order.customer}">
      <td><strong>ORD-${order.id}</strong><small>${order.address}</small></td>
      <td><strong>${order.customer}</strong></td>
      <td>${order.type}</td>
      <td>${order.time}</td>
      <td><span class="status-pill">${order.status}</span></td>
      <td><span class="sync-label ${order.followup ? "issue" : ""}">${order.followup ? "!" : "✓"} ${order.sync}</span></td>
      <td><button class="more-button" aria-label="Flere valg for ORD-${order.id}">•••</button></td>
    </tr>`).join("") || `<tr><td colspan="7"><p class="search-hint">Ingen ordre passer med søket.</p></td></tr>`;
}

function openOrder(id) {
  activeOrderId = id;
  const detail = orderDetails[id] || orders.find(order => order.id === id) || orderDetails["1048"];
  $("#orderEyebrow").textContent = `ORD-${id} · ${detail.type}`;
  $("#orderTitle").textContent = detail.customer;
  $("#drawerAddress").textContent = detail.address;
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

function openAssistant(prompt) {
  $("#assistantDrawer").classList.add("is-open");
  $("#assistantDrawer").setAttribute("aria-hidden", "false");
  $("#overlay").hidden = false;
  document.body.style.overflow = "hidden";
  if (prompt) answerAssistant(prompt);
  else setTimeout(() => $("#assistantInput").focus(), 60);
}

function assistantResponse(prompt) {
  const lower = prompt.toLocaleLowerCase("nb-NO");
  if (lower.includes("ferdigmelde")) {
    return `<p><strong>Besøket kan ikke ferdigmeldes ennå.</strong></p>
      <p>Kravkontrollen fant ett obligatorisk punkt: Serienummer mangler på Mitsubishi Kaiteki 6600.</p>
      <div class="assistant-result"><div><span>!</span><span><strong>Serienummer</strong><small>Påkrevd før ferdigmelding</small></span></div></div>
      <button class="assistant-action" data-assistant-action="serial">Gå til serienummer</button>
      <p class="assistant-source">Kilde: aktivt oppsett og kravkontroll for ORD-${activeOrderId}</p>`;
  }
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

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

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
  $("#searchResults").innerHTML = found.map(order => `<button type="button" class="search-result" data-order="${order.id}"><span>▤</span><span><strong>ORD-${order.id} · ${order.customer}</strong><small>${order.address}</small></span><span>›</span></button>`).join("") || `<p class="search-hint">Ingen treff på «${escapeHtml(query)}».</p>`;
}

function fillDemoViews() {
  $("#agendaDemo").innerHTML = ["I dag · 11. sep", "I morgen · 12. sep", "Mandag · 14. sep", "Tirsdag · 15. sep"].map((day, index) => `<section class="agenda-column"><h2>${day}</h2>${orders.filter(order => index === 0 ? order.today : order.id.charCodeAt(3) % 3 === index - 1).slice(0,3).map(order => `<div class="agenda-item"><strong>${order.time} · ${order.customer}</strong><small>${order.type} · ${order.address.split(",")[0]}</small></div>`).join("")}</section>`).join("");
  $("#customerList").innerHTML = [
    ["AN", "Anne Lise Nordby", "Granstubben 14 · 1 enhet", "Neste service 11.09.2027"],
    ["MS", "Martin Solheim", "Fjellhamarveien 62 · 1 enhet", "Montering pågår"],
    ["BF", "Borettslaget Furulia", "Furuliveien 8B · 12 enheter", "2 åpne ordre"],
    ["NP", "Nordre Park AS", "Industriveien 4 · 8 enheter", "Serviceavtale"]
  ].map(item => `<button class="generic-row"><span class="generic-row-icon">${item[0]}</span><span><strong>${item[1]}</strong><small>${item[2]}</small></span><span class="generic-row-meta">${item[3]} ›</span></button>`).join("");
  $("#deviceList").innerHTML = [
    ["MI", "Mitsubishi Kaiteki 6600", "Anne Lise Nordby · Luft-luft", "Service i dag"],
    ["PA", "Panasonic HZ25XKE", "Martin Solheim · Luft-luft", "Montering pågår"],
    ["DA", "Daikin Perfera 40", "Borettslaget Furulia · Luft-luft", "Krever oppfølging"],
    ["NI", "NIBE S1255", "Nordre Park AS · Væske-vann", "Service om 24 dager"]
  ].map(item => `<button class="generic-row"><span class="generic-row-icon">${item[0]}</span><span><strong>${item[1]}</strong><small>${item[2]}</small></span><span class="generic-row-meta">${item[3]} ›</span></button>`).join("");
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

document.addEventListener("click", event => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) switchView(viewButton.dataset.view, viewButton.dataset.filter);

  const orderTarget = event.target.closest("[data-order]");
  if (orderTarget && !event.target.closest(".more-button")) openOrder(orderTarget.dataset.order);

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
  const filled = event.target.value.trim().length >= 5;
  event.target.classList.toggle("has-error", !filled);
  if (filled) {
    $("#serialRequirement").className = "is-done";
    $("#serialRequirement").innerHTML = `<span aria-hidden="true">✓</span><span><strong>Serienummer registrert</strong><small>${escapeHtml(event.target.value.trim())}</small></span>`;
    $("#completionState").textContent = "Klar til ferdigmelding";
    $(".progress-value").textContent = "100 %";
    $(".progress-track span").style.width = "100%";
  }
});

$("#completeOrderButton").addEventListener("click", () => {
  if ($("#serialNumber").value.trim().length < 5) {
    $("#serialNumber").classList.add("has-error");
    $("#serialNumber").focus();
    showToast("Serienummer må fylles ut før besøket kan ferdigmeldes.");
    return;
  }
  $("#completeOrderButton").textContent = "Besøket er ferdigmeldt";
  $("#completeOrderButton").disabled = true;
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
