import axios from 'axios';
import pkg from 'whatsapp-web.js';
const { Client, MessageMedia, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import 'dotenv/config';

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import PQueue from 'p-queue';
import pino from 'pino';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(
    import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

// --- CONFIGURATION & ÉTAT ---
const logger = pino({
    level: 'info',
    transport: { target: 'pino-pretty', options: { colorize: true } }
});

const mediaQueue = new PQueue({ concurrency: 1 });
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

const TEMP_DIRS = ['videos', 'songs', 'images', 'temp_video'];
let currentQuiz = null; // État pour la commande .quiz

// --- INITIALISATION ---
TEMP_DIRS.forEach(dir => {
    const p = path.join(__dirname, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => logger.info('🚀 Système ZT Bot intégralement déployé.'));

// --- FONCTIONS UTILITAIRES ---
async function isAdmin(chat, user) {
    if (!chat.isGroup) return false;
    const participant = chat.participants.find(p => p.id._serialized === user);
    return participant && (participant.isAdmin || participant.isSuperAdmin);
}

// définition
async function handleDictionary(msg, mot) {
    if (!mot) return msg.reply("⚠️ Usage: .def <mot>");
    try {
        const res = await axios.get(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(mot)}`);
        if (res.data && res.data.extract) {
            const definition = res.data.extract.length > 600 ?
                res.data.extract.substring(0, 600) + '...' :
                res.data.extract;
            msg.reply(`📖 *Définition / Infos (${mot})* :\n\n${definition}`);
        } else {
            msg.reply("❌ Impossible de trouver une définition claire.");
        }
    } catch (e) {
        logger.error(e);
        msg.reply("❌ Mot introuvable ou service indisponible.");
    }
}

async function handleGive(msg) {
    if (!msg.hasQuotedMsg) return msg.reply("⚠️ Réponds à un média avec .give");
    const quotedMsg = await msg.getQuotedMessage();
    if (!quotedMsg.hasMedia) return msg.reply("❌ Aucun média détecté.");

    try {
        await mediaQueue.add(async() => {
            const media = await quotedMsg.downloadMedia();
            await client.sendMessage(msg.from, media, {
                caption: `✅ Média récupéré\n🕒 ${new Date().toLocaleString()}`,
                quotedMessageId: msg.id._serialized
            });
        });
    } catch (e) { msg.reply("❌ Erreur de récupération."); }
}

// --- BOUCLE PRINCIPALE ---
client.on('message', async msg => {
    const body = (msg.body || '').trim();
    const chat = await msg.getChat();
    const sender = msg.author || msg.from;

    // Logique Quiz (Réponse sans point)
    if (currentQuiz && ['a', 'b', 'c'].includes(body.toLowerCase())) {
        if (body.toLowerCase() === currentQuiz.answer) {
            msg.reply("✅ Bravo ! C'est la bonne réponse.");
        } else {
            msg.reply(`❌ Perdu ! La réponse était : ${currentQuiz.answer.toUpperCase()}`);
        }
        currentQuiz = null;
        return;
    }

    if (!body.startsWith('.')) return;

    const command = body.split(' ')[0].toLowerCase();
    const args = body.split(' ').slice(1).join(' ');

    try {
        switch (command) {
            case '.menu':
                const menu = `📋 *ZT BOT - MENU COMPLET*\n\n` +
                    `🎬 .video / 🎵 .songs / 🖼️ .images\n` +
                    `📖 .def <mot> / 🎭 .stik / 📥 .give\n` +
                    `🔥 .otaku / 🤣 .blagues / ❓ .quiz\n` +
                    `📢 .tagall <message> (Admin)\n` +
                    `🌤️ .meto <ville> / 🎲 .dice`;
                await msg.reply(menu);
                break;

            case '.otaku':
                // Rempli pour éviter le crash sur undefined
                const quotes = [
                    { c: "Si tu n'aimes pas ton destin, ne l'accepte pas. À la place, aie le courage de le changer.", a: "Naruto", p: "Naruto Uzumaki" },
                    { c: "Le pouvoir ne vient pas d'un désir, il vient d'un besoin.", a: "Dragon Ball Z", p: "Goku" },
                    { c: "🔥 'Un vrai héros n'est pas celui qui ne tombe jamais, mais celui qui se relève toujours.'", a: "Naruto", p: "Rock Lee" },
                    { c: "⚡ 'La douleur fait partie de la croissance.'", a: "FMAB", p: "Edward Elric" },
                    { c: "🔥 'Je ne vais pas fuir, je ne vais pas reculer, je vais avancer.'", a: "Naruto", p: "Naruto Uzumaki" },
                    { c: "⚡ 'Un cœur qui croit est plus fort que n'importe quelle arme.'", a: "Bleach", p: "Ichigo Kurosaki" },
                    { c: "🌌 'Un homme devient fort quand il protège quelqu'un qu'il aime.'", a: "One Piece", p: "Roronoa Zoro" },
                    { c: "💥 'La douleur est inévitable, mais la souffrance est un choix.'", a: "Naruto Shippuden", p: "Pain (Nagato)" },
                    { c: "🌸 'Même si nous tombons mille fois, nous nous relèverons mille et une fois.'", a: "My Hero Academia", p: "Izuku Midoriya" },
                    { c: "🔥 'Un vrai guerrier sourit face à l'adversité.'", a: "Dragon Ball", p: "Vegeta" },
                    { c: "⚡ 'Ce n'est pas le monde qui est cruel, c'est nous qui le rendons ainsi.'", a: "Tokyo Ghoul", p: "Ken Kaneki" },
                    { c: "🌌 'Un shinobi doit voir au-delà de l'apparence des choses.'", a: "Naruto", p: "Itachi Uchiha" },
                    { c: "💥 'Ceux qui ne connaissent pas la douleur ne peuvent pas comprendre la vraie paix.'", a: "Naruto Shippuden", p: "Nagato" },
                    { c: "🌸 'La magie n'est pas dans les sorts, mais dans le cœur de celui qui les lance.'", a: "Fairy Tail", p: "Makarov Dreyar" },
                    { c: "🔥 'Je veux protéger ceux que j'aime, peu importe le prix.'", a: "Bleach", p: "Rukia Kuchiki" },
                    { c: "⚡ 'Même si tu perds, continue de te battre, car c'est ça être un héros.'", a: "My Hero Academia", p: "All Might" },
                    { c: "🌌 'La liberté est ce qui rend la vie digne d'être vécue.'", a: "Attack on Titan", p: "Eren Yeager" },
                    { c: "💥 'Un homme qui ne risque rien ne peut rien gagner.'", a: "One Piece", p: "Monkey D. Luffy" },
                    { c: "🌸 'La force d'un mage réside dans son cœur.'", a: "Fairy Tail", p: "Natsu Dragneel" }
                ];
                const q = quotes[Math.floor(Math.random() * quotes.length)];
                msg.reply(`🔥 "${q.c}"\n\n🎬 *Anime* : ${q.a}\n👤 *Perso* : ${q.p}`);
                break;

            case '.blagues':
                const blagues = [
                    "Pourquoi les plongeurs plongent-ils toujours en arrière et jamais en avant ? Parce que sinon ils tombent dans le bateau.",
                    "Qu'est-ce qu'un geek qui descend les poubelles ? Un exécuteur de tâches.",
                    "Pourquoi les plongeurs plongent en arrière ? Parce que sinon ils tombent dans le bateau.",
                    "C'est l'histoire d'un pingouin qui respire par les fesses… Un jour il s'assoit et il meurt.",
                    "Pourquoi les canards sont toujours à l'heure ? Parce qu'ils sont dans l'étang.",
                    "Que dit un escargot quand il croise une limace ? « Oh la belle décapotable ! »",
                    "J'ai voulu suivre la lumière au bout du tunnel.C 'était juste la facture d' électricité",
                    "Mon moral est tellement bas que même Google me demande ",
                    "J'ai voulu refaire ma vie. La vie m'a répondu  tu crois que moi - même je suis stable ?",
                    "On m'a dit de suivre mon cœur. Je l'ai suivi… il était en train de fuir.",
                    "Mon espoir est tellement petit que même un microscope a dit non, je vois rien",
                    "Ma chance là, c'est un vrai woro-woro. Quand tu la cherches, elle est déjà partie avec un autre client.",
                    "J'ai demandé à la vie de me calmer un peu. Vie là m'a répondu  toi, tu connais pardon ? ",
                    "Mon avenir est tellement flou que même marabout ne peut pas zoom dedans.",
                    "J'ai voulu arranger mon cœur. Cœur là m'a dit gars, laisse - moi souffrir en paix",
                    "Tellement je suis vilain je salut une dame elle attrape son sac et crie voleur.",
                    "Même bahi est fatiguée de moi. Elle dit  franchement, tu abuses ",
                    "J'ai demandé à la chance de passer me voir. Chance là a répondu  perdu, change de maison",
                    "Les REMBA qui me suivent là, c'est même pas des REMBA, c'est des fans. Ils me traquent comme star.",
                    "🔥 Le travail et la discipline ouvrent la voie à une vie meilleure.",
                    "🌍 La pauvreté n'est pas une fatalité, mais les mauvaises décisions peuvent y conduire.",
                    "💬 Les insultes et moqueries ne construisent rien, mais le respect ouvre des portes.",
                    "🙏 Mets ta confiance dans le travail et dans la foi pour avancer.",
                    "🥦 frape ahoko pour réduit le cancer des coull*",
                    "👀 ya des woubies ici mais j ai pas de preuve",
                    "📸 vue que je suis présent dans le groupes j ai brobro la galerie de tout le monde et ya 15 personnes ici ya peps dans leur galeries",
                    "🍬 si tu veut rester pauvres regardes porno … tu est kpata epuis ces toi qui te joue les meliodas",
                    "💞 ya des gens ici qui sont en couples mais qui bot ahoko",
                    "🤣 said est malo nemo est movais epuis ils ont go",
                    "📚 tu veut conseille?? si tu travaille pas a l école tes enfant regarderons le prix des articles avant d acheter",
                    "🔢 405,490,740 si ta compris faut demander prd a god",
                    "📣 RHDP oyeeeeeeeee",
                    "✅ ADO la solution",
                    "💪 je me woro pour avoir mon djai toi tes la envoie wave envoie wave tchrr c est porno yai tenvoyer",
                    "🔤 le g dans mon prénom signifie gentille et ces pour cela que ya pas de g dans mon prénom mais ya R comme RANCUNE!",
                    "🔤 ya rien dans porno",
                    "🔤 tu regarde des desin doro et tu est coa",
                    "pourquoi tu veut cette commandes?",
                    "BRIGITE MACRON IS THE MAN REVELATION",
                    "🔤 Pourquoi TU VEUT TE kplorlofli sur whatsap ahi",
                    "🔤 DIEU te voit hein!",
                    "ta meme pas honte",
                    "la masturbation tue!",
                    "🔥 Le travail et la discipline ouvrent la voie à une vie meilleure.",
                    "🌍 La pauvreté n'est pas une fatalité, mais les mauvaises décisions peuvent y conduire.",
                    "💬 Les insultes et moqueries ne construisent rien, mais le respect ouvre des portes.",
                    "🙏 Mets ta confiance dans le travail et dans la foi pour avancer.",
                    "🥦 frape ahoko pour réduit le cancer des coull*",
                    "👀 ya des woubies ici mais j ai pas de preuve",
                    "📸 vue que je suis présent dans le groupes j ai brobro la galerie de tout le monde et ya 15 personnes ici ya peps dans leur galeries",
                    "🍬 si tu veut rester pauvres regardes porno … tu est kpata epuis ces toi qui te joue les meliodas",
                    "💞 ya des gens ici qui sont en couples mais qui bot ahoko",
                    "🤣 said est malo nemo est movais epuis ils ont go",
                    "📚 tu veut conseille?? si tu travaille pas a l école tes enfant regarderons le prix des articles avant d acheter",
                    "🔢 405,490,740 si ta compris faut demander prd a god",
                    "📣 RHDP oyeeeeeeeee",
                    "✅ ADO la solution",
                    "💪 je me woro pour avoir mon djai toi tes la envoie wave envoie wave tchrr c est porno yai tenvoyer",
                    "🔤 le g dans mon prénom signifie gentille et ces pour cela que ya pas de g dans mon prénom mais ya R comme RANCUNE!",
                    "🔤 ya rien dans porno",
                    "🔤 tu regarde des desin doro et tu est coa",
                    "pourquoi tu veut cette commandes?",
                    "BRIGITE MACRON IS THE MAN REVELATION",
                    "🔤 Pourquoi TU VEUT TE kplorlofli sur whatsap ahi",
                    "🔤 DIEU te voit hein!",
                    "ta meme pas honte",
                    "la masturbation tue!"
                ];
                msg.reply(`🤣 *Blague* : ${blagues[Math.floor(Math.random() * blagues.length)]}`);
                break;

            case '.quiz':
                const quizList = [
                    { question: "Quelle est la capitale de la Côte d'Ivoire ?\n\na) Abidjan\nb) Yamoussoukro\nc) Bouaké", answer: "b" },
                    { question: "Quel langage utilise-t-on pour dynamiser une page web ?\n\na) HTML\nb) CSS\nc) JavaScript", answer: "c" },
                    { question: "Quelle est la capitale de la Côte d'Ivoire ?\n\na) Abidjan\nb) Yamoussoukro\nc) Bouaké", answer: "b" },
                    { question: "2+2 = ?\na) 3\nb) 4\nc) 5", answer: "b" }, { question: "Quel est le plus grand océan ?\na) Atlantique\nb) Pacifique\nc) Indien", answer: "b" },
                    { question: "Combien de continents existe-t-il ?\na) 5\nb) 6\nc) 7", answer: "c" },
                    { question: "💎 Quelle chanteuse est surnommée 'Queen B' ?\nA) Rihanna\nB) Beyoncé\nC) Nicki Minaj", answer: "b" },
                    { question: "🇯🇲 Quel est le genre musical de Bob Marley ?\nA) Jazz\nB) Reggae\nC) Blues", answer: "b" },
                    { question: "🎸 Combien de cordes a une guitare classique standard ?\nA) 4\nB) 5\nC) 6", answer: "c" },
                    { question: "🏆 Qui détient le record du nombre de Grammy Awards ?\nA) Jay-Z\nB) Beyoncé\nC) Stevie Wonder", answer: "b" },
                    { question: "🇨🇦 De quel pays est originaire Justin Bieber ?\nA) États-Unis\nB) Canada\nC) Angleterre", answer: "b" },
                    { question: "🎺 Quel musicien de jazz jouait de la trompette et était surnommé 'Satchmo' ?\nA) Louis Armstrong\nB) Miles Davis\nC) Duke Ellington", answer: "a" },
                    { question: "🌟 Quel groupe de K-pop a chanté 'Dynamite' ?\nA) EXO\nB) BTS\nC) Blackpink", answer: "b" },
                    { question: "📻 Quel est le premier clip diffusé sur MTV ?\nA) Video Killed the Radio Star\nB) Thriller\nC) Like a Virgin", answer: "a" },
                    { question: "🇫🇷 Quel chanteur français a pour vrai nom Jean-Philippe Smet ?\nA) Johnny Hallyday\nB) Charles Aznavour\nC) Renaud", answer: "a" },
                    { question: "💿 Quel est l'album le plus vendu de tous les temps ?\nA) Back in Black\nB) Thriller\nC) The Dark Side of the Moon", answer: "b" },
                    { question: "🎤 Quelle chanteuse a interprété 'Rolling in the Deep' ?\nA) Adele\nB) Sia\nC) Dua Lipa", answer: "a" },
                    { question: "🎶 Quel compositeur est devenu sourd à la fin de sa vie ?\nA) Bach\nB) Beethoven\nC) Chopin", answer: "b" },
                    { question: "🇺🇸 Quel rappeur a remporté un prix Pulitzer ?\nA) Kendrick Lamar\nB) Eminem\nC) Kanye West", answer: "a" },
                    { question: "💃 Quel est le style de danse de Shakira ?\nA) Salsa\nB) Danse orientale\nC) Flamenco", answer: "b" },
                    { question: "🏴󠁧󠁢󠁳󠁣󠁴󠁿 Quel instrument est le symbole de l'Écosse ?\nA) Harpe\nB) Cornemuse\nC) Accordéon", answer: "b" },
                    { question: "🌑 Quel chanteur est connu pour son 'Moonwalk' ?\nA) James Brown\nB) Michael Jackson\nC) Bruno Mars", answer: "b" },

                    { question: "🏙️ D'où vient le groupe de hip-hop Wu-Tang Clan ?\nA) New York\nB) Los Angeles\nC) Chicago", answer: "a" },

                    { question: "🎻 De quelle famille d'instruments fait partie le piano ?\nA) Cordes frappées\nB) Percussions\nC) Vent", answer: "a" },

                    { question: "🇧🇧 Quel est le pays d'origine de Rihanna ?\nA) Jamaïque\nB) Barbade\nC) Trinité-et-Tobago", answer: "b" },

                    { question: "🎭 Quel festival de musique a eu lieu en 1969 aux USA ?\nA) Coachella\nB) Woodstock\nC) Glastonbury", answer: "b" },

                    { question: "🔥 Qui a chanté 'Girl on Fire' ?\nA) Alicia Keys\nB) Pink\nC) Katy Perry", answer: "a" },

                    { question: "🎹 Combien de touches blanches y a-t-il sur un piano standard ?\nA) 44\nB) 52\nC) 88", answer: "b" },

                    { question: "🇨🇮 Quel genre musical a été créé par Douk Saga ?\nA) Zouglou\nB) Coupé-Décalé\nC) Zoblazo", answer: "b" },

                    { question: "🎤 Quel est le nom de scène de Marshall Mathers ?\nA) 50 Cent\nB) Eminem\nC) Dr. Dre", answer: "b" },

                    { question: "🐝 Comment s'appelle la base de fans de Beyoncé ?\nA) Beliebers\nB) Beyhive\nC) Swifties", answer: "b" }, { question: "🎮 Quel est le jeu le plus vendu de l'histoire ?\nA) GTA V\nB) Minecraft\nC) Tetris", answer: "b" },

                    { question: "🍎 Qui a co-fondé Apple avec Steve Jobs ?\nA) Bill Gates\nB) Steve Wozniak\nC) Mark Zuckerberg", answer: "b" },

                    { question: "🟦 Quelle console a introduit la manette 'DualShock' ?\nA) PlayStation\nB) Nintendo 64\nC) Sega Saturn", answer: "a" },

                    { question: "🕵️‍♂️ Quel est le nom du héros dans 'The Legend of Zelda' ?\nA) Zelda\nB) Link\nC) Ganondorf", answer: "b" },

                    { question: "💻 Que signifie l'acronyme 'RAM' ?\nA) Read Access Memory\nB) Random Access Memory\nC) Real Audio Mode", answer: "b" },

                    { question: "🐥 Quel réseau social a été renommé 'X' par Elon Musk ?\nA) Instagram\nB) Twitter\nC) Facebook", answer: "b" },

                    { question: "👾 Quel jeu a popularisé le genre 'Battle Royale' ?\nA) PUBG\nB) Fortnite\nC) H1Z1", answer: "a" },

                    { question: "🐀 Quel Pokémon est le n°25 du Pokédex ?\nA) Pikachu\nB) Salamèche\nC) Bulbizarre", answer: "a" },

                    { question: "🌐 Qui a inventé le World Wide Web (WWW) ?\nA) Tim Berners-Lee\nB) Bill Gates\nC) Larry Page", answer: "a" },

                    { question: "🚗 Quel jeu de course met en scène Mario et ses amis ?\nA) Need for Speed\nB) Mario Kart\nC) Gran Turismo", answer: "b" },

                    { question: "🔋 Quel métal est principalement utilisé dans les batteries de smartphone ?\nA) Fer\nB) Lithium\nC) Cuivre", answer: "b" },

                    { question: "🛡️ Quel studio a développé 'The Witcher 3' ?\nA) Ubisoft\nB) Rockstar Games\nC) CD Projekt Red", answer: "c" },

                    { question: "🐍 Quel langage de programmation a pour logo un serpent ?\nA) Java\nB) Python\nC) C++", answer: "b" },

                    { question: "🕹️ Quelle entreprise a créé la console 'Game Boy' ?\nA) Sega\nB) Sony\nC) Nintendo", answer: "c" },

                    { question: "🤖 Comment s'appelle l'IA développée par OpenAI ?\nA) Alexa\nB) ChatGPT\nC) Siri", answer: "b" },

                    { question: "🧱 Quel jeu permet de créer des mondes avec des blocs ?\nA) Roblox\nB) Minecraft\nC) Les deux", answer: "c" },

                    { question: "👻 Quel fantôme ne peut pas être mangé par Pac-Man sans bonus ?\nA) Blinky\nB) Inky\nC) Aucun (tous sont dangereux)", answer: "c" },

                    { question: "📱 Quel OS appartient à Google ?\nA) iOS\nB) Windows\nC) Android", answer: "c" },

                    { question: "🔫 Dans quel jeu trouve-t-on la carte 'Dust II' ?\nA) Call of Duty\nB) Counter-Strike\nC) Valorant", answer: "b" },

                    { question: "🏰 Quel jeu met en scène le combat entre l'Alliance et la Horde ?\nA) World of Warcraft\nB) League of Legends\nC) Diablo", answer: "a" },

                    { question: "☁️ Quel est le service de stockage cloud d'Amazon ?\nA) iCloud\nB) AWS\nC) Google Drive", answer: "b" },

                    { question: "🐱 Comment s'appelle la plateforme de code appartenant à Microsoft ?\nA) StackOverflow\nB) GitHub\nC) GitLab", answer: "b" },

                    { question: "⚽ Quel jeu de foot est devenu 'EA Sports FC' ?\nA) PES\nB) FIFA\nC) Football Manager", answer: "b" },

                    { question: "📺 Quel site est le leader mondial du streaming de jeux vidéo ?\nA) YouTube\nB) Twitch\nC) Dailymotion", answer: "b" },

                    { question: "🕶️ Quelle technologie permet de superposer du virtuel sur le réel ?\nA) Réalité Virtuelle\nB) Réalité Augmentée\nC) Hologramme", answer: "b" },

                    { question: "🎮 Quel est le bouton principal pour sauter dans la plupart des jeux PlayStation ?\nA) Carré\nB) Croix\nC) Triangle", answer: "b" },

                    { question: "💾 Quelle était la capacité standard d'une disquette 3.5 pouces ?\nA) 1.44 Mo\nB) 700 Mo\nC) 4.7 Go", answer: "a" },

                    { question: "🕸️ Quel super-héros a le plus de jeux vidéo à son nom ?\nA) Batman\nB) Spider-Man\nC) Superman", answer: "b" },

                    { question: "🏹 Quel jeu de survie se passe avec des dinosaures ?\nA) ARK\nB) Rust\nC) DayZ", answer: "a" },

                    { question: "🔥 Quel navigateur web a un renard de feu pour logo ?\nA) Chrome\nB) Firefox\nC) Safari", answer: "b" }, { question: "🍕 De quelle ville italienne vient la Pizza ?\nA) Rome\nB) Naples\nC) Venise", answer: "b" },

                    { question: "🍣 De quoi est composé principalement un Sashimi ?\nA) Riz et Poisson\nB) Poisson cru uniquement\nC) Algues", answer: "b" },

                    { question: "🥐 Quel pays est célèbre pour ses croissants ?\nA) Autriche\nB) France\nC) Italie", answer: "b" },

                    { question: "🥛 Quel est l'ingrédient principal du fromage ?\nA) Lait\nB) Œufs\nC) Farine", answer: "a" },

                    { question: "🌶️ Quel pays est connu pour sa cuisine très épicée ?\nA) Mexique\nB) Norvège\nC) Canada", answer: "a" },

                    { question: "🧀 Quel fromage français est surnommé 'Le Roi des fromages' ?\nA) Camembert\nB) Roquefort\nC) Brie", answer: "b" },

                    { question: "☕ Quel pays produit le plus de café ?\nA) Brésil\nB) Vietnam\nC) Colombie", answer: "a" },

                    { question: "🥬 Quel régime exclut tout produit d'origine animale ?\nA) Végétarien\nB) Végan\nC) Sans gluten", answer: "b" },

                    { question: "🍛 Quel est l'épice qui donne la couleur jaune au curry ?\nA) Safran\nB) Curcuma\nC) Piment", answer: "b" },

                    { question: "🍫 De quelle plante vient le chocolat ?\nA) Caféier\nB) Cacaoyer\nC) Théier", answer: "b" },

                    { question: "🍜 Dans quel pays sont nés les Ramen ?\nA) Chine\nB) Japon\nC) Corée", answer: "a" },

                    { question: "🍞 Quel ingrédient fait lever la pâte à pain ?\nA) Sel\nB) Levure\nC) Sucre", answer: "b" },

                    { question: "🍵 Quel pays a inventé la cérémonie du thé ?\nA) Chine\nB) Japon\nC) Inde", answer: "b" },

                    { question: "🇨🇮 Quel est l'ingrédient de base de l'Attiéké ?\nA) Igname\nB) Manioc\nC) Patate douce", answer: "b" },

                    { question: "🥔 D'où viennent originellement les pommes de terre ?\nA) Irlande\nB) Amérique du Sud\nC) France", answer: "b" },

                    { question: "🍰 Quel gâteau italien contient du café et du mascarpone ?\nA) Panettone\nB) Tiramisu\nC) Panna Cotta", answer: "b" },

                    { question: "🍹 Quel fruit compose principalement le Guacamole ?\nA) Banane\nB) Avocat\nC) Mangue", answer: "b" },

                    { question: "🥚 Qu'est-ce qu'une omelette 'norvégienne' ?\nA) Une omelette salée\nB) Un dessert glacé\nC) Une soupe", answer: "b" },

                    { question: "🍇 Quel fruit utilise-t-on pour faire du vin ?\nA) Pomme\nB) Raisin\nC) Cerise", answer: "b" },

                    { question: "🍲 Quel est le plat national du Sénégal ?\nA) Thieboudienne\nB) Yassa\nC) Mafé", answer: "a" },

                    { question: "🧂 Quelle est la formule chimique du sel de table ?\nA) NaCl\nB) H2O\nC) CO2", answer: "a" },

                    { question: "🍯 Quel aliment est le seul à ne jamais périmer ?\nA) Riz\nB) Miel\nC) Pâtes", answer: "b" },

                    { question: "🍄 Qu'est-ce qu'une truffe en cuisine ?\nA) Un chocolat\nB) Un champignon\nC) Les deux", answer: "c" },

                    { question: "🥖 Comment appelle-t-on le pain long typiquement français ?\nA) Miche\nB) Baguette\nC) Pavé", answer: "b" },

                    { question: "🍦 Quel parfum de glace est le plus vendu au monde ?\nA) Chocolat\nB) Vanille\nC) Fraise", answer: "b" },

                    { question: "🦞 Comment appelle-t-on la viande de jeune mouton ?\nA) Agneau\nB) Veau\nC) Porc", answer: "a" },

                    { question: "🍝 Quelle forme de pâtes signifie 'petites ficelles' ?\nA) Penne\nB) Spaghetti\nC) Fusilli", answer: "b" },

                    { question: "🥫 Quel fruit est botaniquement une baie mais cuisiné comme légume ?\nA) Tomate\nB) Courgette\nC) Aubergine", answer: "a" },

                    { question: "🍮 Quel pays a inventé les 'Pastéis de Nata' ?\nA) Espagne\nB) Portugal\nC) Brésil", answer: "b" },

                    { question: "🥘 Quel riz utilise-t-on pour faire une Paëlla ?\nA) Riz long\nB) Riz rond\nC) Riz basmati", answer: "b" }, { question: "⚽ Qui a remporté le plus de Ballons d'Or ?\nA) Cristiano Ronaldo\nB) Lionel Messi\nC) Pelé", answer: "b" },

                    { question: "🏀 Dans quelle ville jouent les 'Lakers' ?\nA) Miami\nB) Los Angeles\nC) Chicago", answer: "b" },

                    { question: "🎾 Sur quelle surface se joue le tournoi de Roland Garros ?\nA) Gazon\nB) Terre battue\nC) Dur", answer: "b" },

                    { question: "🥊 Qui était surnommé 'The Greatest' en boxe ?\nA) Mike Tyson\nB) Muhammad Ali\nC) Floyd Mayweather", answer: "b" },

                    { question: "🏃‍♂️ Qui détient le record du monde du 100m ?\nA) Carl Lewis\nB) Usain Bolt\nC) Tyson Gay", answer: "b" },

                    { question: "🏊‍♂️ Quel nageur est le plus médaillé de l'histoire des JO ?\nA) Michael Phelps\nB) Ian Thorpe\nC) Florent Manaudou", answer: "a" },

                    { question: "🚲 Comment s'appelle le leader du classement général du Tour de France ?\nA) Maillot Vert\nB) Maillot Jaune\nC) Maillot à pois", answer: "b" },

                    { question: "🏉 Quel pays a pour emblème une fougère argentée (All Blacks) ?\nA) Australie\nB) Nouvelle-Zélande\nC) Afrique du Sud", answer: "b" },

                    { question: "🏎️ Qui détient le record de titres en F1 (égalité à 7) ?\nA) Hamilton & Schumacher\nB) Verstappen & Senna\nC) Vettel & Prost", answer: "a" },

                    { question: "⛳ Combien de trous y a-t-il sur un parcours de golf standard ?\nA) 9\nB) 12\nC) 18", answer: "c" },

                    { question: "⚽ Quel pays a gagné la première Coupe du Monde en 1930 ?\nA) Brésil\nB) Uruguay\nC) Argentine", answer: "b" },

                    { question: "🏀 Combien de points vaut un lancer franc au basket ?\nA) 1\nB) 2\nC) 3", answer: "a" },

                    { question: "🏸 Quel sport utilise un volant ?\nA) Tennis\nB) Badminton\nC) Squash", answer: "b" },

                    { question: "♟️ Comment appelle-t-on la fin d'une partie d'échecs ?\nA) Échec et Mat\nB) KO\nC) Game Over", answer: "a" },

                    { question: "🏹 Quel sport consiste à tirer sur une cible avec un arc ?\nA) Escrime\nB) Tir à l'arc\nC) Javelot", answer: "b" },

                    { question: "🏋️‍♂️ Quel sport soulève des poids très lourds ?\nA) Athlétisme\nB) Haltérophilie\nC) Judo", answer: "b" },

                    { question: "⛸️ Sur quoi glisse-t-on en patinage artistique ?\nA) Bitume\nB) Glace\nC) Sable", answer: "b" },

                    { question: "🏟️ Où se dérouleront les JO d'été en 2024 ?\nA) Tokyo\nB) Paris\nC) Los Angeles", answer: "b" },

                    { question: "🏈 Comment s'appelle la finale du championnat de foot américain ?\nA) Super Bowl\nB) World Series\nC) NBA Finals", answer: "a" },

                    { question: "🥋 Quel est le grade le plus élevé en judo (ceinture) ?\nA) Noire\nB) Rouge\nC) Blanche", answer: "b" },

                    { question: "🎯 Quel est le score maximum avec 3 fléchettes ?\nA) 100\nB) 150\nC) 180", answer: "c" },

                    { question: "🚣‍♂️ Comment appelle-t-on le sport de course de bateaux à rames ?\nA) Canoë\nB) Aviron\nC) Voile", answer: "b" },

                    { question: "🏔️ Quel sport consiste à grimper des montagnes ?\nA) Alpinisme\nB) Randonnée\nC) Trail", answer: "a" },

                    { question: "🏄‍♂️ Dans quel élément pratique-t-on le surf ?\nA) Air\nB) Eau\nC) Terre", answer: "b" },

                    { question: "🤺 Quels sont les 3 types d'armes en escrime ?\nA) Épée, Fleuret, Sabre\nB) Lance, Épée, Dague\nC) Arc, Sabre, Couteau", answer: "a" },

                    { question: "🎳 Combien de quilles faut-il faire tomber au bowling ?\nA) 8\nB) 10\nC) 12", answer: "b" },

                    { question: "🎮 Quel sport est devenu une discipline olympique en 2024 ?\nA) Échecs\nB) Breakdance\nC) E-sport", answer: "b" },

                    { question: "🃏 Combien de cartes y a-t-il dans un jeu de Poker standard ?\nA) 32\nB) 52\nC) 54", answer: "b" },

                    { question: "🎾 Quel joueur est surnommé 'Le Roi de l'ocre' ?\nA) Federer\nB) Nadal\nC) Djokovic", answer: "b" },

                    { question: "🏆 Tous les combien d'ans ont lieu les JO ?\nA) 2 ans\nB) 4 ans\nC) 5 ans", answer: "b" }, { question: "🔱 Dans la mythologie grecque, qui est le dieu de la foudre ?\nA) Poséidon\nB) Zeus\nC) Hadès", answer: "b" },

                    { question: "🏺 Quelle cité antique était célèbre pour ses guerriers et son éducation stricte ?\nA) Athènes\nB) Sparte\nC) Troie", answer: "b" },

                    { question: "💀 Qui est le passeur des enfers dans la mythologie grecque ?\nA) Charon\nB) Cerbère\nC) Thanatos", answer: "a" },

                    { question: "🦁 Quel animal a un corps de lion et une tête d'homme en Égypte ?\nA) Le Sphinx\nB) Anubis\nC) Horus", answer: "a" },

                    { question: "🔨 Dans la mythologie nordique, comment s'appelle le marteau de Thor ?\nA) Excalibur\nB) Mjöllnir\nC) Gungnir", answer: "b" },

                    { question: "👹 Qui est le dieu de la malice chez les Vikings ?\nA) Odin\nB) Loki\nC) Tyr", answer: "b" },

                    { question: "🍎 Qui a déclenché la guerre de Troie en enlevant Hélène ?\nA) Achille\nB) Pâris\nC) Hector", answer: "b" },

                    { question: "🏛️ Quelle déesse est sortie de la tête de Zeus tout armée ?\nA) Aphrodite\nB) Athéna\nC) Artémis", answer: "b" },

                    { question: "🦅 Quel dieu égyptien possède une tête de faucon ?\nA) Osiris\nB) Horus\nC) Seth", answer: "b" },

                    { question: "🏹 Quelle déesse est la protectrice de la nature et de la chasse ?\nA) Héra\nB) Artémis\nC) Hestia", answer: "b" },

                    { question: "🐺 Qui a allaité Romulus et Rémus, les fondateurs de Rome ?\nA) Une chienne\nB) Une louve\nC) Une lionne", answer: "b" },

                    { question: "🔥 Qui a volé le feu aux dieux pour le donner aux hommes ?\nA) Atlas\nB) Prométhée\nC) Épiméthée", answer: "b" },

                    { question: "🧵 Qui a aidé Thésée à sortir du Labyrinthe grâce à un fil ?\nA) Médée\nB) Ariane\nC) Pénélope", answer: "b" },

                    { question: "🌊 Comment s'appelle le trident de Poséidon dans la mythologie romaine ?\nA) Neptune\nB) Jupiter\nC) Mars", answer: "a" },

                    { question: "🌞 Quel dieu grec conduit le char du soleil ?\nA) Hélios\nB) Hermès\nC) Héphaïstos", answer: "a" },

                    { question: "🐍 Quelle créature transforme en pierre ceux qui la regardent ?\nA) L'Hydre\nB) Méduse\nC) La Chimère", answer: "b" },

                    { question: "🛡️ Quel héros grec est réputé pour son point faible au talon ?\nA) Ulysse\nB) Achille\nC) Hercule", answer: "b" },

                    { question: "🐕 Comment s'appelle le chien à trois têtes qui garde les Enfers ?\nA) Cerbère\nB) Fenrir\nC) Fluffy", answer: "a" },

                    { question: "🔨 Qui est le dieu forgeron de l'Olympe ?\nA) Arès\nB) Héphaïstos\nC) Dionysos", answer: "b" },

                    { question: "⚖️ Quelle déesse égyptienne pèse le cœur des morts avec une plume ?\nA) Isis\nB) Maât\nC) Bastet", answer: "b" },

                    { question: "🐂 Quelle créature mi-homme mi-taureau vivait dans le Labyrinthe ?\nA) Le Centaure\nB) Le Minotaure\nC) Le Satyre", answer: "b" },

                    { question: "🏔️ Où résident les principaux dieux grecs ?\nA) Mont Sinaï\nB) Mont Olympe\nC) Mont Everest", answer: "b" },

                    { question: "👠 Qui est la déesse de l'amour et de la beauté ?\nA) Héra\nB) Aphrodite\nC) Athéna", answer: "b" },

                    { question: "🐱 Quel peuple ancien vénérait les chats comme des êtres sacrés ?\nA) Les Romains\nB) Les Égyptiens\nC) Les Mayas", answer: "b" },

                    { question: "👁️ Comment appelle-t-on les géants avec un seul œil ?\nA) Les Titans\nB) Les Cyclopes\nC) Les Trolls", answer: "b" },

                    { question: "🍺 Qui est le dieu grec du vin et de la fête ?\nA) Apollon\nB) Dionysos\nC) Hermès", answer: "b" },

                    { question: "🌈 Quel pont arc-en-ciel relie le monde des hommes à celui des dieux nordiques ?\nA) Bifröst\nB) Yggdrasil\nC) Valhalla", answer: "a" },

                    { question: "🦅 Quel oiseau renaît de ses cendres ?\nA) Le Griffon\nB) Le Phénix\nC) L'Hippogriffe", answer: "b" },

                    { question: "🗡️ Qui a tué l'Hydre de Lerne lors de ses 12 travaux ?\nA) Thésée\nB) Hercule\nC) Persée", answer: "b" },

                    { question: "🏺 Quelle femme a ouvert une boîte libérant tous les maux de l'humanité ?\nA) Pandore\nB) Cassandre\nC) Circé", answer: "a" }, { question: "🦁 Comment appelle-t-on le cri du lion ?\nA) Le rugissement\nB) Le hululement\nC) L'aboiement", answer: "a" },

                    { question: "🐘 Quel est le plus grand mammifère terrestre ?\nA) L'éléphant d'Afrique\nB) La girafe\nC) Le rhinocéros", answer: "a" },

                    { question: "🦒 Combien de vertèbres a le cou d'une girafe ?\nA) 7\nB) 15\nC) 25", answer: "a" },

                    { question: "🦈 Quel poisson est le plus grand prédateur des océans ?\nA) Le grand requin blanc\nB) L'orque\nC) Le requin baleine", answer: "b" },

                    { question: "🐦 Quel oiseau est capable de voler en arrière ?\nA) L'hirondelle\nB) Le colibri\nC) L'aigle", answer: "b" },

                    { question: "🐍 Quel serpent est le plus long du monde ?\nA) Le Python\nB) L'Anaconda\nC) Le Cobra Royal", answer: "b" },

                    { question: "🐢 Quel animal peut vivre plus de 150 ans ?\nA) La baleine bleue\nB) La tortue géante\nC) L'éléphant", answer: "b" },

                    { question: "🦘 Sur quel continent trouve-t-on des kangourous à l'état sauvage ?\nA) Afrique\nB) Australie\nC) Amérique", answer: "b" },

                    { question: "🐧 Le manchot est un oiseau qui...\nA) Vole très haut\nB) Ne vole pas\nC) Vit en forêt", answer: "b" },

                    { question: "🕷️ Combien de pattes ont les araignées ?\nA) 6\nB) 8\nC) 10", answer: "b" },

                    { question: "🐝 Quel insecte produit du miel ?\nA) Le bourdon\nB) L'abeille\nC) La guêpe", answer: "b" },

                    { question: "🦎 Quel reptile peut changer de couleur pour se camoufler ?\nA) Le lézard\nB) Le caméléon\nC) L'iguane", answer: "b" },

                    { question: "🦋 Quel est le nom du processus de transformation de la chenille ?\nA) La mutation\nB) La métamorphose\nC) La transition", answer: "b" },

                    { question: "🎋 De quoi se nourrit principalement le panda géant ?\nA) De viande\nB) De bambou\nC) De fruits", answer: "b" },

                    { question: "🦓 Quelle est la couleur de la peau d'un zèbre sous ses poils ?\nA) Blanche\nB) Noire\nC) Grise", answer: "b" },

                    { question: "🐳 Quel est le plus gros animal ayant jamais existé ?\nA) Le Diplodocus\nB) La Baleine bleue\nC) Le Mégalodon", answer: "b" },

                    { question: "🐫 Combien de bosses possède un dromadaire ?\nA) 1\nB) 2\nC) 3", answer: "a" },

                    { question: "🦌 Quel est le nom de la femelle du cerf ?\nA) La biche\nB) La chevrette\nC) La daine", answer: "a" },

                    { question: "🐎 Comment appelle-t-on un cheval mâle qui peut se reproduire ?\nA) Un hongre\nB) Un étalon\nC) Un poney", answer: "b" },

                    { question: "🐒 Quel est le plus grand des grands singes ?\nA) Le Chimpanzé\nB) Le Gorille\nC) L'Orang-outan", answer: "b" },

                    { question: "🐌 Quel animal porte sa maison sur son dos ?\nA) La limace\nB) L'escargot\nC) Le scarabée", answer: "b" },

                    { question: "🦉 Quel oiseau est le symbole de la sagesse ?\nA) Le corbeau\nB) La chouette\nC) Le cygne", answer: "b" },

                    { question: "🍄 Les champignons sont des...\nA) Végétaux\n) Fungi (Fonge)\nC) Minéraux", answer: "b" },

                    { question: "🐟 Quel poisson remonte les rivières pour pondre ses œufs ?\nA) Le thon\nB) Le saumon\nC) La sardine", answer: "b" },

                    { question: "🌵 Quelle plante pousse principalement dans le désert ?\nA) Le sapin\nB) Le cactus\nC) Le fougère", answer: "b" },

                    { question: "🦇 Le seul mammifère capable de voler activement est...\nA) L'écureuil volant\nB) La chauve-souris\nC) L'autruche", answer: "b" },

                    { question: "🌊 Quel corail forme la 'Grande Barrière' en Australie ?\nA) Un minéral\nB) Un animal\nC) Un végétal", answer: "b" },

                    { question: "🦏 De quoi est faite la corne du rhinocéros ?\nA) D'os\nB) De kératine (comme les ongles)\nC) D'ivoire", answer: "b" },

                    { question: "🐙 Combien de cœurs possède une pieuvre ?\nA) 1\nB) 2\nC) 3", answer: "c" },

                    { question: "🐾 Quel animal est surnommé 'le meilleur ami de l'homme' ?\nA) Le chat\nB) Le chien\nC) Le cheval", answer: "b" }, { question: "☀️ Quelle est l'étoile la plus proche de la Terre ?\nA) Proxima du Centaure\nB) Le Soleil\nC) Sirius", answer: "b" },

                    { question: "🪐 Quelle planète est célèbre pour ses magnifiques anneaux ?\nA) Jupiter\nB) Saturne\nC) Neptune", answer: "b" },

                    { question: "🔴 Quelle planète est surnommée la 'Planète Rouge' ?\nA) Vénus\nB) Mars\nC) Mercure", answer: "b" },

                    { question: "🌍 Combien de temps la Terre met-elle pour faire le tour du Soleil ?\nA) 24 heures\nB) 365 jours\nC) 28 jours", answer: "b" },

                    { question: "🔭 Quel instrument utilise-t-on pour observer les étoiles ?\nA) Un microscope\nB) Un télescope\nC) Un périscope", answer: "b" },

                    { question: "👨‍🚀 Qui a été le premier homme à marcher sur la Lune ?\nA) Yuri Gagarine\nB) Neil Armstrong\nC) Buzz Aldrin", answer: "b" },

                    { question: "🌌 Comment s'appelle notre galaxie ?\nA) Andromède\nB) La Voie Lactée\nC) Orion", answer: "b" },

                    { question: "🌑 Quel est le satellite naturel de la Terre ?\nA) Mars\nB) La Lune\nC) Titan", answer: "b" },

                    { question: "🌑 Quelle est la plus grosse planète du système solaire ?\nA) Saturne\nB) Jupiter\nC) Terre", answer: "b" },

                    { question: "🌡️ Quelle est la planète la plus chaude du système solaire ?\nA) Mercure\nB) Vénus\nC) Mars", answer: "b" },

                    { question: "🌑 Combien de planètes composent notre système solaire ?\nA) 7\nB) 8\nC) 9", answer: "b" },

                    { question: "🌠 Comment appelle-t-on un bloc de roche qui brûle en entrant dans l'atmosphère ?\nA) Une comète\nB) Un astéroïde\nC) Une étoile filante (météore)", answer: "c" },

                    { question: "🚀 Quelle agence spatiale a envoyé l'homme sur la Lune ?\nA) ESA\nB) NASA\nC) Roscosmos", answer: "b" },

                    { question: "🛰️ Quel a été le premier satellite artificiel envoyé dans l'espace ?\nA) Apollo 11\nB) Spoutnik 1\nC) Voyager 1", answer: "b" },

                    { question: "🌫️ De quoi sont principalement faits les anneaux de Saturne ?\nA) De gaz\nB) De glace et de roche\nC) De métal", answer: "b" },

                    { question: "🌑 Quelle planète n'est plus considérée comme une planète principale depuis 2006 ?\nA) Neptune\nB) Pluton\nC) Uranus", answer: "b" },

                    { question: "🌌 Quel objet céleste a une gravité si forte que même la lumière ne s'en échappe pas ?\nA) Une supernova\nB) Un trou noir\nC) Une naine blanche", answer: "b" },

                    { question: "🌓 Quelle phase de la Lune se situe entre la Nouvelle Lune et la Pleine Lune ?\nA) Premier quartier\nB) Dernier quartier\nC) Éclipse", answer: "a" },

                    { question: "👨‍🚀 Quel pays a envoyé le premier homme dans l'espace ?\nA) USA\nB) URSS\nC) Chine", answer: "b" },

                    { question: "☄️ Comment s'appelle la comète célèbre qui passe près de la Terre tous les 76 ans ?\nA) Hale-Bopp\nB) Halley\nC) Neowise", answer: "b" },

                    { question: "🌑 Quelle est la plus petite planète du système solaire ?\nA) Mars\nB) Mercure\nC) Vénus", answer: "b" },

                    { question: "🔭 Quel est le plus grand télescope spatial actuel (lancé en 2021) ?\nA) Hubble\nB) James Webb\nC) Kepler", answer: "b" },

                    { question: "🚀 Quel milliardaire a fondé la société spatiale SpaceX ?\nA) Jeff Bezos\nB) Elon Musk\nC) Richard Branson", answer: "b" },

                    { question: "🪐 Quelle planète tourne sur le côté (axe très incliné) ?\nA) Saturne\nB) Uranus\nC) Neptune", answer: "b" },

                    { question: "🌡️ Pourquoi fait-il plus chaud sur Vénus que sur Mercure ?\nA) À cause du Soleil\nB) À cause de l'effet de serre\nC) À cause des volcans", answer: "b" },

                    { question: "🌑 Quel est le nom de la mission qui a posé un robot sur une comète ?\nA) Curiosity\nB) Rosetta\nC) Perseverance", answer: "b" },

                    { question: "🌌 Quelle est l'unité de mesure pour les distances entre les étoiles ?\nA) Kilomètre\nB) Unité Astronomique\nC) Année-lumière", answer: "c" },

                    { question: "☀️ Quel gaz compose principalement le Soleil ?\nA) Oxygène\nB) Hydrogène\nC) Azote", answer: "b" },

                    { question: "🚀 Comment s'appelle la station spatiale où vivent les astronautes ?\nA) ISS\nB) Starbase\nC) Mir 2", answer: "a" },

                    { question: "🌠 Quel phénomène se produit quand la Lune passe entre le Soleil et la Terre ?\nA) Éclipse Lunaire\nB) Éclipse Solaire\nC) Aurore Boréale", answer: "b" }, { question: "🟡 Quelle famille jaune vit à Springfield ?\nA) Les Griffin\nB) Les Simpson\nC) Les Smith", answer: "b" },

                    { question: "🐭 Comment s'appelle le chien de Mickey Mouse ?\nA) Dingo\nB) Pluto\nC) Donald", answer: "b" },

                    { question: "🐉 Quel est le nom du dragon dans 'Mulan' ?\nA) Mushu\nB) Haku\nC) Krokmou", answer: "a" },

                    { question: "🕵️‍♂️ Quel détective porte toujours un nœud papillon rouge et des lunettes ?\nA) Sherlock Holmes\nB) Détective Conan\nC) Inspecteur Gadget", answer: "b" },

                    { question: "⚡ Dans Pokémon, quel est le type de l'attaque de Pikachu ?\nA) Feu\nB) Électrique\nC) Eau", answer: "b" },

                    { question: "🌊 Qui vit dans un浪 (ananas) sous la mer ?\nA) Patrick\nB) Bob l'éponge\nC) Carlo", answer: "b" },

                    { question: "🐱 Quel chat essaie sans cesse d'attraper la souris Jerry ?\nA) Garfield\nB) Tom\nC) Sylvestre", answer: "b" },

                    { question: "🏴‍☠️ Quel pirate cherche le trésor 'One Piece' ?\nA) Jack Sparrow\nB) Luffy\nC) Zoro", answer: "b" },

                    { question: "❄️ Comment s'appelle la sœur d'Elsa dans 'La Reine des Neiges' ?\nA) Belle\nB) Anna\nC) Jasmine", answer: "b" },

                    { question: "🦸‍♂️ Quel super-héros vient de la planète Krypton ?\nA) Batman\nB) Superman\nC) Iron Man", answer: "b" },

                    { question: "🥕 Quel lapin dit toujours 'Quoi de neuf, docteur ?' ?\nA) Roger Rabbit\nB) Bugs Bunny\nC) Panpan", answer: "b" },

                    { question: "🛖 Dans Naruto, quel est le titre du chef du village ?\nA) Sensei\nB) Hokage\nC) Shogun", answer: "b" },

                    { question: "🧸 Comment s'appelle le cowboy dans 'Toy Story' ?\nA) Buzz\nB) Woody\nC) Rex", answer: "b" },

                    { question: "🏰 Quel studio a créé 'Le Voyage de Chihiro' et 'Mon Voisin Totoro' ?\nA) Pixar\nB) Ghibli\nC) DreamWorks", answer: "b" },

                    { question: "🐕 Comment s'appelle le chien peureux qui résout des mystères avec Sammy ?\nA) Scooby-Doo\nB) Courage\nC) Rex", answer: "a" },

                    { question: "🧜‍♀️ Quel est le nom du crabe ami d'Ariel dans 'La Petite Sirène' ?\nA) Polochon\nB) Sébastien\nC) Gustave", answer: "b" },

                    { question: "🔨 Quel super-héros Marvel possède un marteau magique ?\nA) Hulk\nB) Thor\nC) Captain America", answer: "b" },

                    { question: "🧚‍♀️ Comment s'appelle la fée amie de Peter Pan ?\nA) Clochette\nB) Flora\nC) Maléfique", answer: "a" },

                    { question: "🚗 Quel est le nom de la voiture de course rouge dans 'Cars' ?\nA) Martin\nB) Flash McQueen\nC) Doc Hudson", answer: "b" },

                    { question: "🦁 Comment s'appelle le méchant oncle de Simba dans 'Le Roi Lion' ?\nA) Mufasa\nB) Scar\nC) Jafar", answer: "b" },

                    { question: "🏹 Quelle princesse Disney est une experte au tir à l'arc ?\nA) Raiponce\nB) Merida (Rebelle)\nC) Tiana", answer: "b" },

                    { question: "🔦 Comment s'appelle l'ami robot de Finn dans 'Adventure Time' ?\nA) BMO\nB) Jake\nC) Gunter", answer: "a" },

                    { question: "🍔 Quel est le nom du restaurant où travaille Bob l'éponge ?\nA) Le Crabe Croustillant\nB) Le Seau de l'Enfer\nC) Pizza Hut", answer: "a" },

                    { question: "🧤 Quel super-vilain veut effacer la moitié de l'univers avec un gant ?\nA) Loki\nB) Thanos\nC) Ultron", answer: "b" },

                    { question: "👦 Quel petit garçon ne veut jamais grandir ?\nA) Mowgli\nB) Peter Pan\nC) Pinocchio", answer: "b" },

                    { question: "🦍 Quel gorille géant vit sur Skull Island ?\nA) Donkey Kong\nB) King Kong\nC) Tarzan", answer: "b" },

                    { question: "💎 Quel est le nom du chat bleu dans 'Oggy et les Cafards' ?\nA) Jack\nB) Oggy\nC) Bob", answer: "b" },

                    { question: "🧙‍♂️ Quel sorcier est le directeur de l'école Poudlard ?\nA) Rogue\nB) Dumbledore\nC) Hagrid", answer: "b" },

                    { question: "🗡️ Dans 'L'Attaque des Titans', contre quoi les humains luttent-ils ?\nA) Des zombies\nB) Des Titans\nC) Des extraterrestres", answer: "b" },

                    { question: "🐼 Quel animal est Po dans 'Kung Fu Panda' ?\nA) Un ours brun\nB) Un panda géant\nC) Un raton laveur", answer: "b" }


                ];
                currentQuiz = quizList[Math.floor(Math.random() * quizList.length)];
                msg.reply(`❓ *QUIZ* :\n\n${currentQuiz.question}\n\n_Réponds simplement par a, b ou c_`);
                break;

            case '.def':
                await handleDictionary(msg, args);
                break;

            case '.give':
                await handleGive(msg);
                break;

            case '.tagall':
            case '.appel':
            case '.apel':
                if (chat.isGroup && (await isAdmin(chat, sender))) {
                    let mentions = chat.participants.map(p => p.id._serialized);
                    let text = `📢 *APPEL GÉNÉRAL*\n\n${args || 'Pas de message'}\n\n`;
                    await chat.sendMessage(text, { mentions });
                } else {
                    msg.reply("🚫 Réservé aux admins dans un groupe.");
                }
                break;

            case '.video':
                if (!args) return msg.reply("⚠️ Spécifie le nom d'une vidéo (ex: .video Kaamelott)");
                msg.reply("⏳ Recherche et téléchargement de la vidéo en cours...");
                await mediaQueue.add(async() => {
                    try {
                        const out = path.join(__dirname, 'temp_video', `v_${Date.now()}.mp4`);
                        await execAsync(`yt-dlp -f "best[height<=480]" --max-filesize 20M -o "${out}" "ytsearch1:${args}"`);
                        if (fs.existsSync(out)) {
                            await client.sendMessage(msg.from, MessageMedia.fromFilePath(out));
                            fs.unlinkSync(out);
                        } else {
                            msg.reply("❌ Impossible de récupérer cette vidéo (fichier introuvable).");
                        }
                    } catch (err) {
                        logger.error(err);
                        msg.reply("❌ Une erreur est survenue lors du traitement de la vidéo.");
                    }
                });
                break;

            case '.songs':
                if (!args) return msg.reply("⚠️ Spécifie le titre d'une chanson (ex: .songs Didi)");
                msg.reply("⏳ Téléchargement de l'audio en cours...");
                await mediaQueue.add(async() => {
                    try {
                        const out = path.join(__dirname, 'songs', `s_${Date.now()}.mp3`);
                        await execAsync(`yt-dlp -x --audio-format mp3 -o "${out}" "ytsearch1:${args}"`);
                        if (fs.existsSync(out)) {
                            await client.sendMessage(msg.from, MessageMedia.fromFilePath(out));
                            fs.unlinkSync(out);
                        } else {
                            msg.reply("❌ Audio introuvable.");
                        }
                    } catch (err) {
                        logger.error(err);
                        msg.reply("❌ Une erreur est survenue lors du téléchargement de la musique.");
                    }
                });
                break;

            case '.images':
                if (!args) return msg.reply("⚠️ Spécifie une recherche d'image.");
                try {
                    const apiUrl = process.env.IMAGE_API_URL;
                    if (!apiUrl) return msg.reply("❌ Erreur : IMAGE_API_URL non configurée.");

                    const imgRes = await axios.get(`${apiUrl}?q=${encodeURIComponent(args)}`);
                    if (imgRes.data.results && imgRes.data.results[0]) {
                        const media = await MessageMedia.fromUrl(imgRes.data.results[0]);
                        await client.sendMessage(msg.from, media, { caption: `🖼️ Recherche : ${args}` });
                    } else {
                        msg.reply("❌ Aucun résultat trouvé.");
                    }
                } catch (e) {
                    msg.reply("❌ Erreur de connexion à l'API Image.");
                }
                break;

            case '.meto':
                if (!args) return msg.reply("⚠️ Usage: .meto <ville>");
                try {
                    // Utilisation du service wttr.in (retourne une ligne de texte propre sans clé API)
                    const res = await axios.get(`https://wttr.in/${encodeURIComponent(args)}?format=3`);
                    msg.reply(`🌤️ *Météo* : ${res.data.trim()}`);
                } catch (e) {
                    msg.reply("❌ Impossible d'accéder au service météo.");
                }
                break;

            case '.stik':
                const target = msg.hasQuotedMsg ? await msg.getQuotedMessage() : msg;
                if (target.hasMedia) {
                    try {
                        const media = await target.downloadMedia();
                        await client.sendMessage(msg.from, media, { sendMediaAsSticker: true, stickerAuthor: "ZT Bot" });
                    } catch (e) {
                        msg.reply("❌ Échec de la conversion en sticker.");
                    }
                } else {
                    msg.reply("⚠️ Réponds à une image avec `.stik` pour la transformer.");
                }
                break;

            case '.dice':
                msg.reply(`🎲 : *${Math.floor(Math.random() * 6) + 1}*`);
                break;
        }
    } catch (e) { logger.error(e); }
});

// Nettoyage automatique
setInterval(() => {
    TEMP_DIRS.forEach(dir => {
        const p = path.join(__dirname, dir);
        if (fs.existsSync(p)) {
            fs.readdirSync(p).forEach(file => {
                const fp = path.join(p, file);
                if ((Date.now() - fs.statSync(fp).mtimeMs) > 3600000) fs.unlinkSync(fp);
            });
        }
    });
}, 3600000);

client.initialize();