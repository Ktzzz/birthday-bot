require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes, PermissionFlagsBits } = require('discord.js');
const cron = require('node-cron');
const db = require('./database');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// ─── Commandes slash ──────────────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Gestion des anniversaires')
    .addSubcommand(s => s
      .setName('set')
      .setDescription('Enregistre ton anniversaire (JJ/MM ou JJ/MM/AAAA)')
      .addStringOption(o => o
        .setName('date')
        .setDescription('Ex : 14/05 ou 14/05/1998')
        .setRequired(true)
      )
    )
    .addSubcommand(s => s
      .setName('remove')
      .setDescription('Supprime ton anniversaire de ce serveur')
    )
    .addSubcommand(s => s
      .setName('list')
      .setDescription('Liste tous les anniversaires du serveur')
    )
    .addSubcommand(s => s
      .setName('next')
      .setDescription('Affiche les 5 prochains anniversaires')
    )
    .addSubcommand(s => s
      .setName('check')
      .setDescription("Vérifie l'anniversaire d'un membre")
      .addUserOption(o => o
        .setName('membre')
        .setDescription('Le membre à vérifier')
        .setRequired(true)
      )
    )
    .addSubcommand(s => s
      .setName('admin-set')
      .setDescription("Définit l'anniversaire d'un membre (Admin)")
      .addUserOption(o => o
        .setName('membre')
        .setDescription('Le membre concerné')
        .setRequired(true)
      )
      .addStringOption(o => o
        .setName('date')
        .setDescription('Ex : 14/05 ou 14/05/1998')
        .setRequired(true)
      )
    )
    .addSubcommand(s => s
      .setName('admin-remove')
      .setDescription("Supprime l'anniversaire d'un membre (Admin)")
      .addUserOption(o => o
        .setName('membre')
        .setDescription('Le membre concerné')
        .setRequired(true)
      )
    ),

  new SlashCommandBuilder()
    .setName('birthday-channel')
    .setDescription('Définit le salon pour les notifications (Admin uniquement)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o
      .setName('salon')
      .setDescription('Le salon où envoyer les notifications')
      .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('birthday-role')
    .setDescription("Définit le rôle attribué le jour de l'anniversaire (Admin uniquement)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(o => o
      .setName('role')
      .setDescription('Le rôle à attribuer')
      .setRequired(true)
    ),
].map(c => c.toJSON());

// ─── Connexion & enregistrement des commandes ─────────────────────────────────

client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Commandes slash enregistrées');
  } catch (err) {
    console.error('❌ Erreur enregistrement des commandes :', err);
  }

  cron.schedule('0 8 * * *', checkTomorrow, { timezone: 'Europe/Paris' });
  cron.schedule('0 9 * * *', checkBirthdays, { timezone: 'Europe/Paris' });
  console.log('⏰ Rappels à 08h00 et anniversaires à 09h00 (Paris)');
});

// ─── Gestion des interactions ─────────────────────────────────────────────────

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  console.log(`📨 Interaction reçue : /${interaction.commandName} par ${interaction.user.tag}`);

  const { commandName, options, guildId, user } = interaction;

  try {

  // /birthday-channel
  if (commandName === 'birthday-channel') {
    const channel = options.getChannel('salon');
    db.setChannel(guildId, channel.id);
    return interaction.reply({
      embeds: [embed('✅ Salon configuré', `Les notifications seront envoyées dans <#${channel.id}>.`, 0x57d6a0)],
      ephemeral: true,
    });
  }

  // /birthday-role
  if (commandName === 'birthday-role') {
    const role = options.getRole('role');
    db.setRole(guildId, role.id);
    return interaction.reply({
      embeds: [embed('✅ Rôle configuré', `Le rôle <@&${role.id}> sera attribué le jour de l'anniversaire.`, 0x57d6a0)],
      ephemeral: true,
    });
  }

  // /birthday
  if (commandName === 'birthday') {
    const sub = options.getSubcommand();

    // SET
    if (sub === 'set') {
      const raw = options.getString('date').trim();
      const parsed = parseDate(raw);
      if (!parsed) {
        return interaction.reply({ content: '❌ Format invalide. Utilise `JJ/MM` ou `JJ/MM/AAAA`.', ephemeral: true });
      }
      db.setBirthday(guildId, user.id, parsed.day, parsed.month, parsed.year);
      const display = parsed.year
        ? `${pad(parsed.day)}/${pad(parsed.month)}/${parsed.year}`
        : `${pad(parsed.day)}/${pad(parsed.month)}`;
      return interaction.reply({
        embeds: [embed('🎂 Anniversaire enregistré !', `Ton anniversaire est le **${display}**. Je m'en souviendrai ! 🥳`, 0x57d6a0)],
      });
    }

    // REMOVE
    if (sub === 'remove') {
      db.removeBirthday(guildId, user.id);
      return interaction.reply({
        embeds: [embed('🗑️ Anniversaire supprimé', 'Ton anniversaire a été retiré de ce serveur.', 0xe07070)],
        ephemeral: true,
      });
    }

    // LIST
    if (sub === 'list') {
      await interaction.deferReply();
      const all = db.getAllBirthdays(guildId);
      if (!all.length) {
        return interaction.editReply({ embeds: [embed('📋 Aucun anniversaire', "Personne n'a encore enregistré son anniversaire.", 0x888888)] });
      }

      const sorted = sortByUpcoming(all);
      const lines = await Promise.all(sorted.map(async b => {
        const member = await interaction.guild.members.fetch(b.userId).catch(() => null);
        const name = member ? member.displayName : `<@${b.userId}>`;
        const date = b.year ? `${pad(b.day)}/${pad(b.month)}/${b.year}` : `${pad(b.day)}/${pad(b.month)}`;
        const age = b.year ? ` *(${currentYear() - b.year} ans en ${currentYear()})* ` : ' ';
        const tag = isToday(b) ? '🎂 **AUJOURD\'HUI !**' : isSoon(b, 7) ? '🔜 *bientôt*' : '';
        return `• **${name}** — ${date}${age}${tag}`;
      }));

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🎂 Anniversaires du serveur')
            .setDescription(lines.join('\n'))
            .setColor(0xf4a261)
            .setFooter({ text: `${all.length} membre(s) enregistré(s)` }),
        ],
      });
    }

    // NEXT
    if (sub === 'next') {
      await interaction.deferReply();
      const all = db.getAllBirthdays(guildId);
      if (!all.length) {
        return interaction.editReply({ embeds: [embed('📋 Aucun anniversaire', "Personne n'a encore enregistré son anniversaire.", 0x888888)] });
      }

      const top5 = sortByUpcoming(all).slice(0, 5);
      const lines = await Promise.all(top5.map(async b => {
        const member = await interaction.guild.members.fetch(b.userId).catch(() => null);
        const name = member ? member.displayName : `<@${b.userId}>`;
        const days = daysUntil(b);
        const when = days === 0 ? '**aujourd\'hui 🎂**' : `dans **${days} jour(s)**`;
        return `• **${name}** — ${pad(b.day)}/${pad(b.month)} (${when})`;
      }));

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔜 Prochains anniversaires')
            .setDescription(lines.join('\n'))
            .setColor(0x8ecae6),
        ],
      });
    }

    // ADMIN-SET
    if (sub === 'admin-set') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: "❌ Tu n'as pas la permission de faire ça.", ephemeral: true });
      }
      const target = options.getUser('membre');
      const raw = options.getString('date').trim();
      const parsed = parseDate(raw);
      if (!parsed) {
        return interaction.reply({ content: '❌ Format invalide. Utilise `JJ/MM` ou `JJ/MM/AAAA`.', ephemeral: true });
      }
      db.setBirthday(guildId, target.id, parsed.day, parsed.month, parsed.year);
      const display = parsed.year
        ? `${pad(parsed.day)}/${pad(parsed.month)}/${parsed.year}`
        : `${pad(parsed.day)}/${pad(parsed.month)}`;
      return interaction.reply({
        embeds: [embed('🎂 Anniversaire enregistré !', `L'anniversaire de **${target.username}** est le **${display}**.`, 0x57d6a0)],
        ephemeral: true,
      });
    }

    // ADMIN-REMOVE
    if (sub === 'admin-remove') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: "❌ Tu n'as pas la permission de faire ça.", ephemeral: true });
      }
      const target = options.getUser('membre');
      db.removeBirthday(guildId, target.id);
      return interaction.reply({
        embeds: [embed('🗑️ Anniversaire supprimé', `L'anniversaire de **${target.username}** a été retiré.`, 0xe07070)],
        ephemeral: true,
      });
    }

    // CHECK
    if (sub === 'check') {
      const target = options.getUser('membre');
      const b = db.getBirthday(guildId, target.id);
      if (!b) {
        return interaction.reply({
          embeds: [embed('❓ Inconnu', `${target.username} n'a pas enregistré son anniversaire.`, 0x888888)],
          ephemeral: true,
        });
      }
      const date = b.year ? `${pad(b.day)}/${pad(b.month)}/${b.year}` : `${pad(b.day)}/${pad(b.month)}`;
      const days = daysUntil(b);
      const when = days === 0 ? "C'est **aujourd'hui** ! 🎂" : `Dans **${days} jour(s)**`;
      return interaction.reply({
        embeds: [embed(`🎂 ${target.username}`, `Date : **${date}**\n${when}`, 0x8ecae6)],
      });
    }
  }
  } catch (err) {
    console.error('❌ Erreur dans le handler :', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Une erreur est survenue.', ephemeral: true }).catch(() => {});
    }
  }
});

// ─── Vérification quotidienne des anniversaires ───────────────────────────────

async function checkBirthdays() {
  const today = new Date();
  const day = today.getDate();
  const month = today.getMonth() + 1;

  for (const [guildId, guild] of client.guilds.cache) {
    const channelId = db.getChannel(guildId);
    if (!channelId) continue;

    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) continue;

    // Retirer le rôle d'anniversaire de tous ceux qui l'ont encore
    const roleId = db.getRole(guildId);
    if (roleId) {
      const role = guild.roles.cache.get(roleId);
      if (role) {
        for (const [, member] of role.members) {
          await member.roles.remove(role).catch(console.error);
        }
      }
    }

    const birthdays = db.getBirthdaysByDate(guildId, day, month);
    for (const b of birthdays) {
      const member = await guild.members.fetch(b.userId).catch(() => null);
      if (!member) continue;

      // Attribuer le rôle d'anniversaire
      if (roleId) {
        const role = guild.roles.cache.get(roleId);
        if (role) await member.roles.add(role).catch(console.error);
      }

      const ageText = b.year ? ` a **${today.getFullYear() - b.year} ans**` : '';
      await channel.send({
        content: `🎂 @everyone`,
        embeds: [
          new EmbedBuilder()
            .setTitle('🎉 Joyeux Anniversaire !')
            .setDescription(`Souhaitons un joyeux anniversaire à ${member}${ageText} ! 🥳`)
            .setColor(0xf4a261)
            .setThumbnail(member.user.displayAvatarURL())
            .setFooter({ text: guild.name })
            .setTimestamp(),
        ],
      }).catch(console.error);
    }
  }
}

async function checkTomorrow() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = tomorrow.getDate();
  const month = tomorrow.getMonth() + 1;

  for (const [guildId, guild] of client.guilds.cache) {
    const channelId = db.getChannel(guildId);
    if (!channelId) continue;

    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) continue;

    const birthdays = db.getBirthdaysByDate(guildId, day, month);
    if (!birthdays.length) continue;

    const names = await Promise.all(birthdays.map(async b => {
      const member = await guild.members.fetch(b.userId).catch(() => null);
      return member ? `🎂 **${member.displayName}**` : `🎂 <@${b.userId}>`;
    }));

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('🔔 Rappel — Anniversaire demain !')
          .setDescription(`${names.join('\n')}\nN'oublie pas de les souhaiter demain ! 🥳`)
          .setColor(0x8ecae6)
          .setTimestamp(),
      ],
    }).catch(console.error);
  }
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function parseDate(str) {
  const parts = str.split('/');
  if (parts.length < 2) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parts[2] ? parseInt(parts[2], 10) : null;
  if (isNaN(day) || isNaN(month) || day < 1 || day > 31 || month < 1 || month > 12) return null;
  if (year !== null && (isNaN(year) || year < 1900 || year > new Date().getFullYear())) return null;
  return { day, month, year };
}

function pad(n) { return String(n).padStart(2, '0'); }
function currentYear() { return new Date().getFullYear(); }

function daysUntil(b) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const next = new Date(now.getFullYear(), b.month - 1, b.day);
  if (next < today) next.setFullYear(now.getFullYear() + 1);
  return Math.round((next - today) / 86400000);
}

function isToday(b) {
  const now = new Date();
  return now.getDate() === b.day && now.getMonth() + 1 === b.month;
}

function isSoon(b, days) {
  const d = daysUntil(b);
  return d > 0 && d <= days;
}

function sortByUpcoming(list) {
  return [...list].sort((a, b) => daysUntil(a) - daysUntil(b));
}

function embed(title, description, color) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
}

// ─── Démarrage ────────────────────────────────────────────────────────────────

client.login(process.env.DISCORD_TOKEN);
