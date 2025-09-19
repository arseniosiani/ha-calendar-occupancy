/*
  calendar-aggregate-card.js
  A Lovelace custom card that shows a calendar view aggregating multiple calendar entities.

  Install:
  1) Save this file as /config/www/calendar-aggregate-card.js
  2) In Home Assistant: Settings → Dashboards → (top-right) ⋮ → Manage resources → Add resource
     URL: /local/calendar-aggregate-card.js  Type: JavaScript Module
  3) In your dashboard, add a Manual card with:

  type: 'custom:calendar-aggregate-card'
  title: Calendario
  entities:
    - calendar.family
    - calendar.work
  view: month   # or 'agenda'
  days_ahead: 14  # used when view = 'agenda'

  Notes:
  - This card fetches events via the Calendar API: /api/calendars/<entity_id>?start=...&end=...
  - Only the frontend; no backend integration needed.
*/

/* global customElements, HTMLElement */

// Use Lit from HA (available to custom cards) without external imports
const Lit = window.litHtml || window.Lit || window.litElement || window.lit;
const { LitElement, html, css, nothing } = window.LitElement
  ? { LitElement: window.LitElement, html: window.html, css: window.css, nothing: window.nothing }
  : Lit || {};

function ensureLit() {
  if (!LitElement || !html || !css) {
    throw new Error(
      "Lit not found. Ensure you loaded this as a JavaScript Module resource and you're on a recent Home Assistant."
    );
  }
}

const CARD_VERSION = "0.1.0";

class CalendarAggregateCard extends LitElement {
  static get properties() {
    return {
      hass: {},
      _config: {},
      _events: { state: true },
      _busy: { state: true },
      _error: { state: true },
      _range: { state: true },
    };
  }

  static get styles() {
    return css`
      :host { display: block; }
      .header { display:flex; align-items:center; justify-content:space-between; padding: 8px 12px; }
      .title { font-weight: 600; }
      .controls button { cursor: pointer; }
      .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; padding: 8px; }
      .cell { border: 1px solid var(--divider-color); border-radius: 8px; min-height: 90px; padding: 6px; overflow: hidden; }
      .cell .day { font-size: 0.85em; opacity: 0.7; margin-bottom: 4px; }
      .event { font-size: 0.85em; padding: 2px 4px; border-radius: 6px; margin-bottom: 2px; background: var(--primary-background-color); border: 1px solid var(--divider-color); }
      .muted { opacity: 0.5; }
      .agenda { padding: 8px; }
      .ag-item { border-bottom: 1px solid var(--divider-color); padding: 6px 0; }
      .chip { display:inline-block; padding:0 6px; border-radius: 8px; margin-left:6px; font-size: 0.75em; border: 1px solid var(--divider-color); }
    `;
  }

  setConfig(config) {
    ensureLit();
    if (!config || !config.entities || !Array.isArray(config.entities) || config.entities.length === 0) {
      throw new Error("Imposta almeno una entità calendario in 'entities'.");
    }
    this._config = {
      title: config.title || "Calendario",
      entities: config.entities,
      view: config.view || "month", // 'month' | 'agenda'
      days_ahead: Number(config.days_ahead ?? 14),
    };

    // Initialize to current month range
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    this._range = { start: first, end: last };

    this._events = [];
    this._busy = false;
    this._error = undefined;

    this._fetch();
  }

  getCardSize() {
    return this._config?.view === "agenda" ? 4 : 8;
  }

  _iso(d) {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
  }

  async _fetch() {
    if (!this.hass) return;
    if (!this._config?.entities?.length) return;
    this._busy = true; this._error = undefined;

    try {
      const start = this._range.start;
      const end = this._range.end;

      const all = [];
      for (const ent of this._config.entities) {
        const url = `calendars/${encodeURIComponent(ent)}?start=${encodeURIComponent(this._iso(start))}&end=${encodeURIComponent(this._iso(end))}`;
        const events = await this.hass.callApi("GET", url);
        for (const ev of events) {
          all.push({ ...ev, _entity: ent });
        }
      }
      // sort by start time
      all.sort((a, b) => new Date(a.start) - new Date(b.start));
      this._events = all;
    } catch (e) {
      // Older HA may require /api prefix if not using callApi. The built-in callApi handles it.
      this._error = e?.message || String(e);
    } finally {
      this._busy = false;
    }
  }

  _prevMonth() {
    const { start } = this._range;
    const prev = new Date(start.getFullYear(), start.getMonth() - 1, 1);
    const end = new Date(prev.getFullYear(), prev.getMonth() + 1, 0);
    this._range = { start: prev, end };
    this._fetch();
  }

  _nextMonth() {
    const { start } = this._range;
    const next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const end = new Date(next.getFullYear(), next.getMonth() + 1, 0);
    this._range = { start: next, end };
    this._fetch();
  }

  _today() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    this._range = { start: first, end: last };
    this._fetch();
  }

  _monthMatrix() {
    const first = this._range.start;
    const last = this._range.end;

    // Determine first day to show (start from Monday)
    const firstDayIndex = (first.getDay() + 6) % 7; // 0=Mon
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - firstDayIndex);

    const days = [];
    for (let i = 0; i < 42; i++) { // 6 weeks grid
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      days.push(d);
    }
    return days;
  }

  _eventsOnDay(day) {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59);
    return this._events.filter((e) => {
      const s = new Date(e.start);
      const ed = new Date(e.end || e.start);
      return ed >= start && s <= end;
    });
  }

  _formatDate(d) {
    return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
  }

  _formatTime(d) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  render() {
    ensureLit();
    if (!this._config) return nothing;

    const title = this._config.title || "Calendario";

    return html`
      <ha-card>
        <div class="header">
          <div class="title">${title}</div>
          <div class="controls">
            <button @click=${this._today.bind(this)}>Oggi</button>
            <button @click=${this._prevMonth.bind(this)}>&lt;</button>
            <button @click=${this._nextMonth.bind(this)}>&gt;</button>
          </div>
        </div>
        ${this._error ? html`<div class="error" style="color: var(--error-color); padding: 0 12px 12px;">${this._error}</div>` : nothing}
        ${this._config.view === 'agenda' ? this._renderAgenda() : this._renderMonth()}
      </ha-card>
    `;
  }

  _renderMonth() {
    const days = this._monthMatrix();
    const month = this._range.start.getMonth();
    return html`
      <div class="grid">
        ${days.map((d) => {
      const others = d.getMonth() !== month;
      const evs = this._eventsOnDay(d);
      return html`
            <div class="cell ${others ? 'muted' : ''}">
              <div class="day">${d.getDate()}/${d.getMonth() + 1}</div>
              ${evs.slice(0, 6).map((e) => {
        const start = e.start ? new Date(e.start) : null;
        const time = start ? this._formatTime(start) : '';
        return html`<div class="event" title="${e.summary}\n${e.description || ''}">${time ? time + ' · ' : ''}${e.summary}
                  <span class="chip">${(e._entity || '').split('.').pop()}</span>
                </div>`;
      })}
              ${evs.length > 6 ? html`<div class="event">+${evs.length - 6} altro…</div>` : nothing}
            </div>
          `;
    })}
      </div>
    `;
  }

  _renderAgenda() {
    const now = new Date();
    const end = new Date(now); end.setDate(end.getDate() + (this._config.days_ahead || 14));
    const evs = this._events.filter((e) => new Date(e.end || e.start) >= now && new Date(e.start) <= end);
    return html`
      <div class="agenda">
        ${evs.length === 0 ? html`<div class="muted">Nessun evento</div>` : nothing}
        ${evs.map((e) => {
      const s = new Date(e.start);
      const ed = new Date(e.end || e.start);
      return html`
            <div class="ag-item">
              <div><strong>${e.summary}</strong> <span class="chip">${(e._entity || '').split('.').pop()}</span></div>
              <div>${this._formatDate(s)} ${this._formatTime(s)} – ${this._formatDate(ed)} ${this._formatTime(ed)}</div>
              ${e.location ? html`<div>${e.location}</div>` : nothing}
            </div>
          `;
    })}
      </div>
    `;
  }

  static getConfigElement() {
    return document.createElement("calendar-aggregate-card-editor");
  }

  static getManifest() {
    return {
      type: "object",
      properties: {
        type: { const: "custom:calendar-aggregate-card" },
        title: { type: "string" },
        entities: { type: "array", items: { type: "string" }, minItems: 1 },
        view: { type: "string", enum: ["month", "agenda"] },
        days_ahead: { type: "number" },
      },
      required: ["type", "entities"],
    };
  }

  static getStubConfig(hass, entities) {
    const calendars = (entities || []).filter((e) => e.startsWith("calendar."));
    return { type: "custom:calendar-aggregate-card", title: "Calendario", entities: calendars.slice(0, 2) };
  }
}

customElements.define("calendar-aggregate-card", CalendarAggregateCard);

class CalendarAggregateCardEditor extends LitElement {
  static get properties() {
    return { hass: {}, _config: {} };
  }

  setConfig(config) {
    this._config = { view: "month", ...config };
  }

  get _entities() {
    return this._config.entities || [];
  }

  _update(changed) {
    const ev = new CustomEvent("config-changed", { detail: { config: this._config } });
    this.dispatchEvent(ev);
  }

  _pickEntities(ev) {
    const value = ev.detail.value;
    // ha-entity-picker returns single value; we allow multi by comma-sep in this simple editor
    const list = (value || "").split(",").map((s) => s.trim()).filter(Boolean);
    this._config = { ...this._config, entities: list };
    this._update();
  }

  _setView(ev) {
    const view = ev.target.value;
    this._config = { ...this._config, view };
    this._update();
  }

  _setTitle(ev) {
    this._config = { ...this._config, title: ev.target.value };
    this._update();
  }

  _setDays(ev) {
    this._config = { ...this._config, days_ahead: Number(ev.target.value || 14) };
    this._update();
  }

  render() {
    ensureLit();
    if (!this.hass) return html``;

    return html`
      <div class="editor" style="display:grid; gap: 12px; padding: 12px;">
        <paper-input label="Titolo" .value=${this._config.title || ""} @value-changed=${this._setTitle}></paper-input>

        <paper-dropdown-menu label="Vista">
          <paper-listbox slot="dropdown-content" selected=${this._config.view === "agenda" ? 1 : 0} @iron-select=${(e) => this._setView({ target: { value: e.detail.item.getAttribute('data-value') } })}>
            <paper-item data-value="month">Mese</paper-item>
            <paper-item data-value="agenda">Agenda</paper-item>
          </paper-listbox>
        </paper-dropdown-menu>

        ${this._config.view === 'agenda' ? html`
          <paper-input label="Giorni avanti (agenda)" type="number" .value=${this._config.days_ahead ?? 14} @value-changed=${this._setDays}></paper-input>
        ` : nothing}

        <div>
          <div style="opacity:0.8; margin-bottom:4px;">Entità Calendario (scrivi più entità separate da virgola)</div>
          <paper-input label="calendar.family, calendar.work" .value=${(this._entities || []).join(", ")} @value-changed=${this._pickEntities}></paper-input>
          <div style="opacity:0.6; font-size: 0.9em;">Suggerimento: puoi copiare i nomi delle entità da Impostazioni → Dispositivi e servizi → Entità.</div>
        </div>
      </div>
    `;
  }
}

customElements.define("calendar-aggregate-card-editor", CalendarAggregateCardEditor);

console.info(
  `%c CALENDAR-AGGREGATE-CARD %c v${CARD_VERSION}`,
  "background:#0b5; color:white; padding:2px 6px; border-radius:4px;",
  "color:#0b5"
);
