import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
dayjs.extend(localizedFormat);

class CalendarOccupancy extends HTMLElement {
  config;
  content;
  _monthKey;
  _eventsIndex = new Set();
  _fetching = false;

  setConfig(config) {
    if (!config?.entities || !Array.isArray(config.entities)) {
      throw new Error('Please define "entities" as an array');
    }
    this.config = {
      start_on_monday: true,
      month_offset: 0, // 0 = current month
      ...config,
    };
  }

  _keyFor(date) {
    return dayjs(date).format('YYYY-MM-DD');
  }

  _monthFrame(baseDate) {
    const viewDate = dayjs(baseDate).add(this.config.month_offset || 0, 'month').startOf('month');
    const monthStart = viewDate.startOf('month');
    const monthEnd = viewDate.endOf('month');

    const startOnMonday = this.config.start_on_monday !== false;
    const dow = monthStart.day(); // 0 Sun - 6 Sat
    const shift = startOnMonday ? ((dow + 6) % 7) : dow;
    const gridStart = monthStart.subtract(shift, 'day');

    return { viewDate, monthStart, monthEnd, gridStart };
  }

  async _loadEventsForMonth(hass, entities, monthStart, monthEnd) {
    const startISO = monthStart.startOf('day').toISOString();
    const endISO = monthEnd.endOf('day').toISOString();

    const promises = entities.map((entity_id) =>
      hass.callWS({
        type: 'calendar/list_events',
        entity_id,
        start_time: startISO,
        end_time: endISO,
      }).catch(() => [])
    );

    const results = await Promise.all(promises);
    const all = results.flat();

    const marked = new Set();
    for (const ev of all) {
      const start = dayjs(ev.start);
      const end = dayjs(ev.end);
      let day = start.startOf('day');
      let last = end.startOf('day');
      if (end.hour() === 0 && end.minute() === 0 && end.second() === 0) {
        last = last.subtract(1, 'day');
      }
      while (day.isSameOrBefore(last, 'day')) {
        marked.add(this._keyFor(day));
        day = day.add(1, 'day');
      }
    }
    return marked;
  }

  async _ensureMonthData(hass) {
    const baseNow = dayjs();
    const { viewDate, monthStart, monthEnd, gridStart } = this._monthFrame(baseNow);
    const monthKey = viewDate.format('YYYY-MM');

    if (this._fetching || this._monthKey === monthKey) return { viewDate, monthStart, monthEnd, gridStart };

    this._fetching = true;
    try {
      const marked = await this._loadEventsForMonth(hass, this.config.entities, monthStart, monthEnd);
      this._eventsIndex = marked;
      this._monthKey = monthKey;
    } finally {
      this._fetching = false;
    }
    return { viewDate, monthStart, monthEnd, gridStart };
  }

  set hass(hass) {
    const { entities } = this.config;

    if (!this.content) {
      const title = this.config.title || 'Occupancy';
      this.innerHTML = `
        <ha-card header="${title}">
          <style>
            .calendar {
              display: grid;
              grid-template-columns: repeat(7, 1fr);
              gap: 6px;
              padding: 6px;
            }
            .weekday {
              font-weight: 600;
              text-align: center;
              opacity: 0.7;
              font-size: 0.9em;
            }
            .day {
              position: relative;
              border-radius: 8px;
              padding: 8px;
              min-height: 48px;
              display: flex;
              align-items: flex-start;
              justify-content: flex-end;
              background: var(--ha-card-background, rgba(0,0,0,0.04));
            }
            .day.out { opacity: 0.5; }
            .num { font-size: 0.95em; }
            .dot {
              position: absolute;
              left: 8px;
              bottom: 8px;
              width: 8px; height: 8px;
              border-radius: 50%;
              background: var(--primary-color);
            }
            .month-title { padding: 8px 12px 0; font-weight: 600; }
          </style>
          <div class="month-title"></div>
          <div class="calendar"></div>
        </ha-card>
      `;
      this.content = this.querySelector('.calendar');
      this._titleEl = this.querySelector('.month-title');
    }

    this._render(hass, entities);
  }

  async _render(hass, entities) {
    const { viewDate, gridStart } = await this._ensureMonthData(hass);

    const monthName = viewDate.locale(hass.locale?.language || undefined).format('MMMM YYYY');
    this._titleEl.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    const startOnMonday = this.config.start_on_monday !== false;
    const dayNames = [];
    let base = dayjs().day(0); // Sunday of current week
    for (let i = 0; i < 7; i++) {
      const d = startOnMonday ? base.add(i + 1, 'day') : base.add(i, 'day');
      dayNames.push(d.locale(hass.locale?.language || undefined).format('dd'));
    }

    const cells = [];
    let day = gridStart;
    for (let i = 0; i < 42; i++) {
      const inMonth = day.month() === viewDate.month();
      const key = this._keyFor(day);
      const hasEvent = this._eventsIndex.has(key);
      cells.push(`
        <div class="day ${inMonth ? '' : 'out'}" data-date="${key}">
          <span class="num">${day.date()}</span>
          ${hasEvent ? '<span class="dot"></span>' : ''}
        </div>
      `);
      day = day.add(1, 'day');
    }

    this.content.innerHTML = [
      dayNames.map((w) => `<div class="weekday">${w}</div>`).join(''),
      cells.join(''),
    ].join('');
  }
}

customElements.define('ha-calendar-occupancy', CalendarOccupancy);
