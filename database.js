const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'birthdays.json');

function read() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { birthdays: [], settings: [] };
  }
}

function write(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  setBirthday(guildId, userId, day, month, year = null) {
    const data = read();
    const existing = data.birthdays.find(b => b.guildId === guildId && b.userId === userId);
    if (existing) {
      existing.day = day; existing.month = month; existing.year = year;
    } else {
      data.birthdays.push({ guildId, userId, day, month, year });
    }
    write(data);
  },

  removeBirthday(guildId, userId) {
    const data = read();
    data.birthdays = data.birthdays.filter(b => !(b.guildId === guildId && b.userId === userId));
    write(data);
  },

  getBirthday(guildId, userId) {
    return read().birthdays.find(b => b.guildId === guildId && b.userId === userId) ?? null;
  },

  getAllBirthdays(guildId) {
    return read().birthdays.filter(b => b.guildId === guildId);
  },

  getBirthdaysByDate(guildId, day, month) {
    return read().birthdays.filter(b => b.guildId === guildId && b.day === day && b.month === month);
  },

  setChannel(guildId, channelId) {
    const data = read();
    const existing = data.settings.find(s => s.guildId === guildId);
    if (existing) { existing.channelId = channelId; }
    else { data.settings.push({ guildId, channelId }); }
    write(data);
  },

  getChannel(guildId) {
    const s = read().settings.find(s => s.guildId === guildId);
    return s?.channelId ?? null;
  },
};
