import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import isoWeek from 'dayjs/plugin/isoWeek' // ES 2015
import 'dayjs/locale/it'

dayjs.locale('it')
dayjs.extend(isoWeek);
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
      future_weeks: 20,
      past_weeks: 1,
      ...config,
    };
  }


  set hass(hass) {
    const { entities } = this.config;
    const colors = [
      "var(--red-color)",
      "var(--blue-color)",
      "var(--green-color)",
      "var(--purple-color)",
      "var(--deep-purple-color)",
      "var(--indigo-color)",
      "var(--light-blue-color)",
    ]

    if (!this.content) {
      const title = this.config.title || '';
      this.innerHTML = `
        <ha-card header="${title}">
          <style>
            .calendar {
              display: grid;
              grid-template-columns: repeat(7, 1fr);
              gap: 1px;
              padding: 1px;
              background-color: var(--ha-color-neutral-60);
            }
            .weekday {
              font-weight: 600;
              text-align: center;
              font-size: 0.9em;
              background: var(--card-background-color);
            }
            .day {
              color: rgba(255,255,255,0.5);
              position: relative;
              min-height: 48px;
              display: flex;
              align-items: flex-start;
              justify-content: center;
              background: var(--card-background-color);
            }
            .day.past { opacity: 0.75; }
            .today {
              background: var(--ha-color-primary-10);
            }
            .num { font-size: 0.95em; }
            .reserved {
              top: 20px;
            }
            .cal_1 {
              background: ${colors[0]};
            }
            .cal_2 {
              background: ${colors[1]};
            }
            .cal_3 {
              background: ${colors[2]};
            }
            .cal_4 {
              background: ${colors[3]};
            }
            .block {
              top: 35px;
              background-image: linear-gradient(45deg, #878787 25%, #636363 25%, #636363 50%, #878787 50%, #878787 75%, #636363 75%, #636363 100%);
              background-size: 8.00px 8.00px;
              filter: brightness(0.75);
            }
            .bar_null {
              position: absolute;
              left: -1px;
              bottom: 8px;
              width: 102%;
              height: 18px;
              background: none;

            }
            .bar_fill {
              position: absolute;
              left: -1px;
              width: 102%;
              height: 15px;
            }
            .bar_enter {
              position: absolute;
              left: 55%;
              width: 46%;
              height: 15px;
              border-top-left-radius: 4px;
              border-bottom-left-radius: 4px;
            }
            .bar_leave {
              position: absolute;
              left: -1px;
              width: 45%;
              height: 15px;
              border-top-right-radius: 4px;
              border-bottom-right-radius: 4px;
            }
            .month-title { padding: 8px 12px 0; font-weight: 600; }
          </style>
          <div class="month-title"></div>
          <div class="calendar"></div>
        </ha-card>
      `;
      this.content = this.querySelector('.calendar');
      this._titleEl = this.querySelector('.month-title');
      this._render(hass, entities);
    }
  }

  async _render(hass, entities) {
    const grid = await getData(hass, entities, this.config.past_weeks, this.config.future_weeks)

    const dayNames = [
      "lun",
      "mar",
      "mer",
      "gio",
      "ven",
      "sab",
      "dom",
    ];

    const cells = [];
    for (const date in grid) {
      const bars = []
      const cals = grid[date].cals || []
      let top = 0
      for (const cal_id of entities) {
        top++
        // if (!cals[cal_id]) {
        //   bars.push(`<span class="bar_null top_${top}"></span>`)
        // }
        for (const piece of cals[cal_id] || []) {
          const fragment = piece.event
          const { occupancy, summary } = piece
          bars.push(`<span class="bar_${fragment} cal_${top} ${occupancy}" title="${summary}"></span>`)
        }
      }
      const past = dayjs(date).format("YYMMDD") < dayjs().format("YYMMDD") ? "past" : ''
      const today = dayjs(date).format("YYMMDD") === dayjs().format("YYMMDD") ? "today" : ''

      let label = dayjs(date).format("D")
      if (label === "1") {
        label = dayjs(date).format("MMM D")
      }
      cells.push(`
        <div class="day ${today} ${past}" data-date="${date}">
          <span class="num">${label.toUpperCase()}</span>
          ${bars.join("")}
        </div>
      `);
    }
    this.content.innerHTML = [
      dayNames.map((w) => `<div class="weekday">${w}</div>`).join(''),
      cells.join(''),
    ].join('');
  }
}

customElements.define('ha-calendar-occupancy', CalendarOccupancy);

const getGrid = (n_past, n_future) => {
  const today = dayjs()
  const start = today.add(n_past * 7 * -1, 'days').startOf("isoWeek")
  const num_cells = n_past * 7 + 7 + n_future * 7
  const days = {}
  for (let i = 0; i < num_cells; i++) {
    const day = start.add(i, 'days')
    days[day.format("YYYY-MM-DD")] = {
      date: day.format("YYYY-MM-DD")
    }
  }
  return days
}

const loadEvents = async (hass, entities, grid) => {
  const dates = Object.values(grid).map(d => d.date)
  const startISO = dayjs(dates[0]).startOf('day').toISOString();
  const endISO = dayjs(dates[dates.length - 1]).endOf('day').toISOString();

  for (const entity_id of entities) {
    const events = await hass.callApi(
      "GET",
      `calendars/${entity_id}${encodeURI(`?start=${startISO}&end=${endISO}`)}`
    )
    for (const ev of events) {
      const start = ev.start.date
      const end = ev.end.date
      let done = false
      let i_day = 0
      while (!done) {
        const day = dayjs(start).add(i_day, 'days').format("YYYY-MM-DD")
        if (day === end) {
          done = true
        }
        let type = "fill"
        if (i_day === 0) {
          type = 'enter'
        }
        if (done) {
          type = 'leave'
        }
        if (grid[day]) {
          if (!grid[day].cals) {
            grid[day].cals = {}
          }

          const { summary } = ev
          let occupancy = 'reserved'

          if (entity_id.match(/airbnb/i)) {
            occupancy = 'block'
            if (summary.toLowerCase().match(/reserved/)) {
              occupancy = 'reserved'
            }
          }

          if (!grid[day].cals[entity_id]) {
            grid[day].cals[entity_id] = []
          }
          grid[day].cals[entity_id].push({
            event: type,
            occupancy: occupancy,
            summary
          })
        }
        i_day++
      }
    }
  }
}

const getData = async (hass, entities, past_weeks, future_weeks) => {
  const grid = getGrid(past_weeks, future_weeks)
  await loadEvents(hass, entities, grid);
  return grid
}
