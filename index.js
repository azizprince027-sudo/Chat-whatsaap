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

const __filename = fileURLToPath(import.meta.url);
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

// FIX: Map par chat pour éviter les conflits entre groupes
const currentQuizzes = new Map();

// Cooldown : empêche le spam des commandes lourdes (video, songs)
const cooldowns = new Map();
const COOLDOWN_MS = 30000; // 30 secondes

function isOnCooldown(userId, command) {
    const key = `${userId}:${command}`;
    const last = cooldowns.get(key);
    if (last && Date.now() - last < COOLDOWN_MS) return true;
    cooldowns.set(key, Date.now());
    return false;
}

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

// FIX: Définition via API dictionnaire (plus précis que Wikipedia)
async function handleDictionary(msg, mot) {
    if (!mot) return await msg.reply("⚠️ Usage: .def <mot>");
    try {
        // Tentative via l'API dictionnaire française
        const res = await axios.get(
            `https://api.dictionaryapi.dev/api/v2/entries/fr/${encodeURIComponent(mot)}`,
            { timeout: 8000 }
        );
        if (res.data && res.data[0]?.meanings?.length > 0) {
            const meaning = res.data[0].meanings[0];
            const def = meaning.definitions[0]?.definition || 'Aucune définition disponible.';
            await msg.reply(`📖 *Définition de "${mot}"* :\n\n${def}`);
            return;
        }
    } catch (_) {
        // Si l'API dictionnaire échoue, fallback sur Wikipedia
    }

    try {
        const res = await axios.get(
            `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(mot)}`,
            { timeout: 8000 }
        );
        if (res.data?.extract) {
            const definition = res.data.extract.length > 600
                ? res.data.extract.substring(0, 600) + '...'
                : res.data.extract;
            await msg.reply(`📖 *Infos sur "${mot}"* (Wikipedia) :\n\n${definition}`);
        } else {
            await msg.reply("❌ Impossible de trouver une définition claire.");
        }
    } catch (e) {
        logger.error(e);
        await msg.reply("❌ Mot introuvable ou service indisponible.");
    }
}

async function handleGive(msg) {
    if (!msg.hasQuotedMsg) return await msg.reply("⚠️ Réponds à un média avec .give");
    const quotedMsg = await msg.getQuotedMessage();
    if (!quotedMsg.hasMedia) return await msg.reply("❌ Aucun média détecté.");

    try {
        await mediaQueue.add(async () => {
            const media = await quotedMsg.downloadMedia();
            await client.sendMessage(msg.from, media, {
                caption: `✅ Média récupéré\n🕒 ${new Date().toLocaleString()}`,
                quotedMessageId: msg.id._serialized
            });
        });
    } catch (e) {
        logger.error(e);
        await msg.reply("❌ Erreur de récupération.");
    }
}

// --- DONNÉES ---
const animeQuotes = [
    { c: "Si tu n'aimes pas ton destin, ne l'accepte pas. À la place, aie le courage de le changer.", a: "Naruto", p: "Naruto Uzumaki" },
    { c: "Le pouvoir ne vient pas d'un désir, il vient d'un besoin.", a: "Dragon Ball Z", p: "Goku" },
    { c: "Un vrai héros n'est pas celui qui ne tombe jamais, mais celui qui se relève toujours.", a: "Naruto", p: "Rock Lee" },
    { c: "La douleur fait partie de la croissance.", a: "FMAB", p: "Edward Elric" },
    { c: "Je ne vais pas fuir, je ne vais pas reculer, je vais avancer.", a: "Naruto", p: "Naruto Uzumaki" },
    { c: "Un cœur qui croit est plus fort que n'importe quelle arme.", a: "Bleach", p: "Ichigo Kurosaki" },
    { c: "Un homme devient fort quand il protège quelqu'un qu'il aime.", a: "One Piece", p: "Roronoa Zoro" },
    { c: "La douleur est inévitable, mais la souffrance est un choix.", a: "Naruto Shippuden", p: "Pain (Nagato)" },
    { c: "Même si nous tombons mille fois, nous nous relèverons mille et une fois.", a: "My Hero Academia", p: "Izuku Midoriya" },
    { c: "Un vrai guerrier sourit face à l'adversité.", a: "Dragon Ball", p: "Vegeta" },
    { c: "Ce n'est pas le monde qui est cruel, c'est nous qui le rendons ainsi.", a: "Tokyo Ghoul", p: "Ken Kaneki" },
    { c: "Un shinobi doit voir au-delà de l'apparence des choses.", a: "Naruto", p: "Itachi Uchiha" },
    { c: "Ceux qui ne connaissent pas la douleur ne peuvent pas comprendre la vraie paix.", a: "Naruto Shippuden", p: "Nagato" },
    { c: "La magie n'est pas dans les sorts, mais dans le cœur de celui qui les lance.", a: "Fairy Tail", p: "Makarov Dreyar" },
    { c: "Je veux protéger ceux que j'aime, peu importe le prix.", a: "Bleach", p: "Rukia Kuchiki" },
    { c: "Même si tu perds, continue de te battre, car c'est ça être un héros.", a: "My Hero Academia", p: "All Might" },
    { c: "La liberté est ce qui rend la vie digne d'être vécue.", a: "Attack on Titan", p: "Eren Yeager" },
    { c: "Un homme qui ne risque rien ne peut rien gagner.", a: "One Piece", p: "Monkey D. Luffy" },
    { c: "La force d'un mage réside dans son cœur.", a: "Fairy Tail", p: "Natsu Dragneel" }
];

// FIX: Suppression des doublons dans les blagues
const blagues = [
    "Pourquoi les plongeurs plongent-ils toujours en arrière et jamais en avant ? Parce que sinon ils tombent dans le bateau.",
    "Qu'est-ce qu'un geek qui descend les poubelles ? Un exécuteur de tâches.",
    "C'est l'histoire d'un pingouin qui respire par les fesses… Un jour il s'assoit et il meurt.",
    "Pourquoi les canards sont toujours à l'heure ? Parce qu'ils sont dans l'étang.",
    "Que dit un escargot quand il croise une limace ? « Oh la belle décapotable ! »",
    "J'ai voulu suivre la lumière au bout du tunnel. C'était juste la facture d'électricité.",
    "Mon moral est tellement bas que même Google me demande 'Vouliez-vous dire : bonheur ?'",
    "J'ai voulu refaire ma vie. La vie m'a répondu : tu crois que moi-même je suis stable ?",
    "On m'a dit de suivre mon cœur. Je l'ai suivi… il était en train de fuir.",
    "Mon espoir est tellement petit que même un microscope a dit : non, je vois rien.",
    "Ma chance là, c'est un vrai woro-woro. Quand tu la cherches, elle est déjà partie avec un autre client.",
    "J'ai demandé à la vie de me calmer un peu. Vie là m'a répondu : toi, tu connais pardon ?",
    "Mon avenir est tellement flou que même marabout ne peut pas zoom dedans.",
    "J'ai voulu arranger mon cœur. Cœur là m'a dit : gars, laisse-moi souffrir en paix.",
    "Tellement je suis vilain, je salue une dame, elle attrape son sac et crie au voleur.",
    "Même bahi est fatiguée de moi. Elle dit : franchement, tu abuses.",
    "J'ai demandé à la chance de passer me voir. Chance là a répondu : perdu, change de maison.",
    "Les REMBA qui me suivent là, c'est même pas des REMBA, c'est des fans. Ils me traquent comme star.",
    "🔥 Le travail et la discipline ouvrent la voie à une vie meilleure.",
    "🌍 La pauvreté n'est pas une fatalité, mais les mauvaises décisions peuvent y conduire.",
    "💬 Les insultes et moqueries ne construisent rien, mais le respect ouvre des portes.",
    "🙏 Mets ta confiance dans le travail et dans la foi pour avancer.",
    "👀 Ya des woubies ici mais j'ai pas de preuve.",
    "📚 Tu veux conseille ? Si tu travailles pas à l'école, tes enfants regarderont le prix des articles avant d'acheter.",
    "🔤 Le G dans mon prénom signifie Gentil… et c'est pour ça que ya pas de G dans mon prénom, mais ya R comme RANCUNE !"
];

const quizList = [
    { question: "Quelle est la capitale officielle de la Côte d'Ivoire ?\n\na) Abidjan\nb) Yamoussoukro\nc) Bouaké", answer: "b" },
    { question: "Quel langage utilise-t-on pour dynamiser une page web ?\n\na) HTML\nb) CSS\nc) JavaScript", answer: "c" },
    { question: "2+2 = ?\na) 3\nb) 4\nc) 5", answer: "b" },
    { question: "Quel est le plus grand océan ?\na) Atlantique\nb) Pacifique\nc) Indien", answer: "b" },
    { question: "Combien de continents existe-t-il ?\na) 5\nb) 6\nc) 7", answer: "c" },
    { question: "💎 Quelle chanteuse est surnommée 'Queen B' ?\na) Rihanna\nb) Beyoncé\nc) Nicki Minaj", answer: "b" },
    { question: "🇯🇲 Quel est le genre musical de Bob Marley ?\na) Jazz\nb) Reggae\nc) Blues", answer: "b" },
    { question: "🎸 Combien de cordes a une guitare classique standard ?\na) 4\nb) 5\nc) 6", answer: "c" },
    { question: "🌟 Quel groupe de K-pop a chanté 'Dynamite' ?\na) EXO\nb) BTS\nc) Blackpink", answer: "b" },
    { question: "🎤 Quelle chanteuse a interprété 'Rolling in the Deep' ?\na) Adele\nb) Sia\nc) Dua Lipa", answer: "a" },
    { question: "🎶 Quel compositeur est devenu sourd à la fin de sa vie ?\na) Bach\nb) Beethoven\nc) Chopin", answer: "b" },
    { question: "🇺🇸 Quel rappeur a remporté un prix Pulitzer ?\na) Kendrick Lamar\nb) Eminem\nc) Kanye West", answer: "a" },
    { question: "🇨🇮 Quel genre musical a été créé par Douk Saga ?\na) Zouglou\nb) Coupé-Décalé\nc) Zoblazo", answer: "b" },
    { question: "🌑 Quel chanteur est connu pour son 'Moonwalk' ?\na) James Brown\nb) Michael Jackson\nc) Bruno Mars", answer: "b" },
    { question: "🎮 Quel est le jeu le plus vendu de l'histoire ?\na) GTA V\nb) Minecraft\nc) Tetris", answer: "b" },
    { question: "🍎 Qui a co-fondé Apple avec Steve Jobs ?\na) Bill Gates\nb) Steve Wozniak\nc) Mark Zuckerberg", answer: "b" },
    { question: "🕵️ Quel est le nom du héros dans 'The Legend of Zelda' ?\na) Zelda\nb) Link\nc) Ganondorf", answer: "b" },
    { question: "💻 Que signifie l'acronyme 'RAM' ?\na) Read Access Memory\nb) Random Access Memory\nc) Real Audio Mode", answer: "b" },
    { question: "🐥 Quel réseau social a été renommé 'X' par Elon Musk ?\na) Instagram\nb) Twitter\nc) Facebook", answer: "b" },
    { question: "🐍 Quel langage de programmation a pour logo un serpent ?\na) Java\nb) Python\nc) C++", answer: "b" },
    { question: "📱 Quel OS appartient à Google ?\na) iOS\nb) Windows\nc) Android", answer: "c" },
    { question: "🍕 De quelle ville italienne vient la Pizza ?\na) Rome\nb) Naples\nc) Venise", answer: "b" },
    { question: "🥐 Quel pays est célèbre pour ses croissants ?\na) Autriche\nb) France\nc) Italie", answer: "b" },
    { question: "☕ Quel pays produit le plus de café ?\na) Brésil\nb) Vietnam\nc) Colombie", answer: "a" },
    { question: "🍫 De quelle plante vient le chocolat ?\na) Caféier\nb) Cacaoyer\nc) Théier", answer: "b" },
    { question: "🇨🇮 Quel est l'ingrédient de base de l'Attiéké ?\na) Igname\nb) Manioc\nc) Patate douce", answer: "b" },
    { question: "🍯 Quel aliment est le seul à ne jamais périmer ?\na) Riz\nb) Miel\nc) Pâtes", answer: "b" },
    { question: "⚽ Qui a remporté le plus de Ballons d'Or ?\na) Cristiano Ronaldo\nb) Lionel Messi\nc) Pelé", answer: "b" },
    { question: "🏀 Dans quelle ville jouent les 'Lakers' ?\na) Miami\nb) Los Angeles\nc) Chicago", answer: "b" },
    { question: "🥊 Qui était surnommé 'The Greatest' en boxe ?\na) Mike Tyson\nb) Muhammad Ali\nc) Floyd Mayweather", answer: "b" },
    { question: "🏃 Qui détient le record du monde du 100m ?\na) Carl Lewis\nb) Usain Bolt\nc) Tyson Gay", answer: "b" },
    { question: "🏊 Quel nageur est le plus médaillé de l'histoire des JO ?\na) Michael Phelps\nb) Ian Thorpe\nc) Florent Manaudou", answer: "a" },
    { question: "⚽ Quel pays a gagné la première Coupe du Monde en 1930 ?\na) Brésil\nb) Uruguay\nc) Argentine", answer: "b" },
    { question: "🔱 Dans la mythologie grecque, qui est le dieu de la foudre ?\na) Poséidon\nb) Zeus\nc) Hadès", answer: "b" },
    { question: "🔨 Dans la mythologie nordique, comment s'appelle le marteau de Thor ?\na) Excalibur\nb) Mjöllnir\nc) Gungnir", answer: "b" },
    { question: "🏛️ Quelle déesse est sortie de la tête de Zeus tout armée ?\na) Aphrodite\nb) Athéna\nc) Artémis", answer: "b" },
    { question: "🔥 Qui a volé le feu aux dieux pour le donner aux hommes ?\na) Atlas\nb) Prométhée\nc) Épiméthée", answer: "b" },
    { question: "🐍 Quelle créature transforme en pierre ceux qui la regardent ?\na) L'Hydre\nb) Méduse\nc) La Chimère", answer: "b" },
    { question: "🛡️ Quel héros grec est réputé pour son point faible au talon ?\na) Ulysse\nb) Achille\nc) Hercule", answer: "b" },
    { question: "🏺 Quelle femme a ouvert une boîte libérant tous les maux de l'humanité ?\na) Pandore\nb) Cassandre\nc) Circé", answer: "a" },
    { question: "🦁 Comment appelle-t-on le cri du lion ?\na) Le rugissement\nb) Le hululement\nc) L'aboiement", answer: "a" },
    { question: "🐘 Quel est le plus grand mammifère terrestre ?\na) L'éléphant d'Afrique\nb) La girafe\nc) Le rhinocéros", answer: "a" },
    { question: "🐦 Quel oiseau est capable de voler en arrière ?\na) L'hirondelle\nb) Le colibri\nc) L'aigle", answer: "b" },
    { question: "🐢 Quel animal peut vivre plus de 150 ans ?\na) La baleine bleue\nb) La tortue géante\nc) L'éléphant", answer: "b" },
    { question: "🕷️ Combien de pattes ont les araignées ?\na) 6\nb) 8\nc) 10", answer: "b" },
    { question: "🦎 Quel reptile peut changer de couleur pour se camoufler ?\na) Le lézard\nb) Le caméléon\nc) L'iguane", answer: "b" },
    { question: "🎋 De quoi se nourrit principalement le panda géant ?\na) De viande\nb) De bambou\nc) De fruits", answer: "b" },
    { question: "🐫 Combien de bosses possède un dromadaire ?\na) 1\nb) 2\nc) 3", answer: "a" },
    { question: "🐙 Combien de cœurs possède une pieuvre ?\na) 1\nb) 2\nc) 3", answer: "c" },
    { question: "☀️ Quelle est l'étoile la plus proche de la Terre ?\na) Proxima du Centaure\nb) Le Soleil\nc) Sirius", answer: "b" },
    { question: "🪐 Quelle planète est célèbre pour ses magnifiques anneaux ?\na) Jupiter\nb) Saturne\nc) Neptune", answer: "b" },
    { question: "👨‍🚀 Qui a été le premier homme à marcher sur la Lune ?\na) Yuri Gagarine\nb) Neil Armstrong\nc) Buzz Aldrin", answer: "b" },
    { question: "🌌 Comment s'appelle notre galaxie ?\na) Andromède\nb) La Voie Lactée\nc) Orion", answer: "b" },
    { question: "🌑 Quelle est la plus grosse planète du système solaire ?\na) Saturne\nb) Jupiter\nc) Terre", answer: "b" },
    { question: "🚀 Quelle agence spatiale a envoyé l'homme sur la Lune ?\na) ESA\nb) NASA\nc) Roscosmos", answer: "b" },
    { question: "🌑 Quelle planète n'est plus considérée comme planète principale depuis 2006 ?\na) Neptune\nb) Pluton\nc) Uranus", answer: "b" },
    { question: "🌌 Quel objet céleste a une gravité si forte que même la lumière ne s'en échappe pas ?\na) Une supernova\nb) Un trou noir\nc) Une naine blanche", answer: "b" },
    { question: "🚀 Quel milliardaire a fondé la société spatiale SpaceX ?\na) Jeff Bezos\nb) Elon Musk\nc) Richard Branson", answer: "b" },
    { question: "🟡 Quelle famille jaune vit à Springfield ?\na) Les Griffin\nb) Les Simpson\nc) Les Smith", answer: "b" },
    { question: "🐭 Comment s'appelle le chien de Mickey Mouse ?\na) Dingo\nb) Pluto\nc) Donald", answer: "b" },
    { question: "🐉 Quel est le nom du dragon dans 'Mulan' ?\na) Mushu\nb) Haku\nc) Krokmou", answer: "a" },
    { question: "⚡ Dans Pokémon, quel est le type de l'attaque de Pikachu ?\na) Feu\nb) Électrique\nc) Eau", answer: "b" },
    { question: "🐱 Quel chat essaie sans cesse d'attraper la souris Jerry ?\na) Garfield\nb) Tom\nc) Sylvestre", answer: "b" },
    { question: "❄️ Comment s'appelle la sœur d'Elsa dans 'La Reine des Neiges' ?\na) Belle\nb) Anna\nc) Jasmine", answer: "b" },
    { question: "🦸 Quel super-héros vient de la planète Krypton ?\na) Batman\nb) Superman\nc) Iron Man", answer: "b" },
    { question: "🛖 Dans Naruto, quel est le titre du chef du village ?\na) Sensei\nb) Hokage\nc) Shogun", answer: "b" },
    { question: "🧸 Comment s'appelle le cowboy dans 'Toy Story' ?\na) Buzz\nb) Woody\nc) Rex", answer: "b" },
    { question: "🏰 Quel studio a créé 'Le Voyage de Chihiro' et 'Mon Voisin Totoro' ?\na) Pixar\nb) Ghibli\nc) DreamWorks", answer: "b" },
    { question: "🔨 Quel super-héros Marvel possède un marteau magique ?\na) Hulk\nb) Thor\nc) Captain America", answer: "b" },
    { question: "🚗 Quel est le nom de la voiture de course rouge dans 'Cars' ?\na) Martin\nb) Flash McQueen\nc) Doc Hudson", answer: "b" },
    { question: "🦁 Comment s'appelle le méchant oncle de Simba dans 'Le Roi Lion' ?\na) Mufasa\nb) Scar\nc) Jafar", answer: "b" },
    { question: "🧤 Quel super-vilain veut effacer la moitié de l'univers avec un gant ?\na) Loki\nb) Thanos\nc) Ultron", answer: "b" },
    { question: "🧙 Quel sorcier est le directeur de l'école Poudlard ?\na) Rogue\nb) Dumbledore\nc) Hagrid", answer: "b" }
];

// --- BOUCLE PRINCIPALE ---
client.on('message', async msg => {
    const body = (msg.body || '').trim();
    const chat = await msg.getChat();
    const sender = msg.author || msg.from;

    // FIX: Quiz par chat (clé = msg.from) pour éviter les conflits entre groupes
    const activeQuiz = currentQuizzes.get(msg.from);
    if (activeQuiz && ['a', 'b', 'c'].includes(body.toLowerCase())) {
        if (body.toLowerCase() === activeQuiz.answer) {
            await msg.reply("✅ Bravo ! C'est la bonne réponse. 🎉");
        } else {
            await msg.reply(`❌ Perdu ! La réponse était : *${activeQuiz.answer.toUpperCase()}*`);
        }
        currentQuizzes.delete(msg.from);
        return;
    }

    if (!body.startsWith('.')) return;

    const command = body.split(' ')[0].toLowerCase();
    const args = body.split(' ').slice(1).join(' ');

    try {
        switch (command) {

            case '.menu':
                await msg.reply(
                    `📋 *ZT BOT - MENU COMPLET*\n\n` +
                    `🎬 .video <titre> / 🎵 .songs <titre> / 🖼️ .images <catégorie>\n` +
                    `📖 .def <mot> / 🎭 .stik / 📥 .give\n` +
                    `🔥 .otaku / 🤣 .blagues / ❓ .quiz\n` +
                    `📢 .tagall <message> (Admin)\n` +
                    `🌤️ .meto <ville> / 🎲 .dice / 🏓 .ping`
                );
                break;

            // Nouvelle commande utile
            case '.ping':
                await msg.reply(`🏓 Pong ! ZT Bot est en ligne. ✅\n🕒 ${new Date().toLocaleString('fr-FR')}`);
                break;

            case '.otaku':
                const q = animeQuotes[Math.floor(Math.random() * animeQuotes.length)];
                await msg.reply(`🔥 *"${q.c}"*\n\n🎬 Anime : ${q.a}\n👤 Perso : ${q.p}`);
                break;

            case '.blagues':
                await msg.reply(`🤣 *Blague* :\n\n${blagues[Math.floor(Math.random() * blagues.length)]}`);
                break;

            case '.quiz':
                // FIX: stockage par chat
                const picked = quizList[Math.floor(Math.random() * quizList.length)];
                currentQuizzes.set(msg.from, picked);
                await msg.reply(`❓ *QUIZ* :\n\n${picked.question}\n\n_Réponds simplement par a, b ou c_`);
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
                    const mentions = chat.participants.map(p => p.id._serialized);
                    const text = `📢 *APPEL GÉNÉRAL*\n\n${args || 'Pas de message'}\n\n`;
                    await chat.sendMessage(text, { mentions });
                } else {
                    await msg.reply("🚫 Réservé aux admins dans un groupe.");
                }
                break;

            case '.video':
                if (!args) return await msg.reply("⚠️ Spécifie le nom d'une vidéo (ex: .video Kaamelott)");
                // FIX: cooldown pour éviter le spam
                if (isOnCooldown(sender, 'video')) {
                    return await msg.reply("⏳ Attends encore quelques secondes avant une nouvelle vidéo.");
                }
                await msg.reply("⏳ Recherche et téléchargement en cours, patiente...");
                await mediaQueue.add(async () => {
                    const out = path.join(__dirname, 'temp_video', `v_${Date.now()}.mp4`);
                    try {
                        // FIX: timeout de 60s pour éviter un blocage infini
                        await execAsync(
                            `yt-dlp -f "best[height<=480]" --max-filesize 20M -o "${out}" "ytsearch1:${args}"`,
                            { timeout: 60000 }
                        );
                        if (fs.existsSync(out)) {
                            await client.sendMessage(msg.from, MessageMedia.fromFilePath(out));
                            fs.unlinkSync(out);
                        } else {
                            await msg.reply("❌ Vidéo introuvable ou trop lourde (max 20MB).");
                        }
                    } catch (err) {
                        logger.error(err);
                        if (fs.existsSync(out)) fs.unlinkSync(out); // nettoyage même en cas d'erreur
                        await msg.reply("❌ Erreur lors du téléchargement de la vidéo.");
                    }
                });
                break;

            case '.songs':
                if (!args) return await msg.reply("⚠️ Spécifie le titre d'une chanson (ex: .songs Didi)");
                // FIX: cooldown
                if (isOnCooldown(sender, 'songs')) {
                    return await msg.reply("⏳ Attends encore quelques secondes avant une nouvelle chanson.");
                }
                await msg.reply("⏳ Téléchargement audio en cours...");
                await mediaQueue.add(async () => {
                    const out = path.join(__dirname, 'songs', `s_${Date.now()}.mp3`);
                    try {
                        // FIX: timeout de 60s
                        await execAsync(
                            `yt-dlp -x --audio-format mp3 -o "${out}" "ytsearch1:${args}"`,
                            { timeout: 60000 }
                        );
                        if (fs.existsSync(out)) {
                            await client.sendMessage(msg.from, MessageMedia.fromFilePath(out));
                            fs.unlinkSync(out);
                        } else {
                            await msg.reply("❌ Audio introuvable.");
                        }
                    } catch (err) {
                        logger.error(err);
                        if (fs.existsSync(out)) fs.unlinkSync(out);
                        await msg.reply("❌ Erreur lors du téléchargement de la musique.");
                    }
                });
                break;

            case '.images':
                // Catégories spéciales nekos.best et waifu.pics
                const NEKOS_CATS    = ['neko', 'waifu', 'kitsune', 'husbando'];
                const WAIFUPICS_CATS = [
                    'shinobu', 'megumin', 'cuddle', 'cry', 'hug',
                    'kiss', 'pat', 'poke', 'slap', 'tickle', 'blush',
                    'smile', 'wave', 'highfive', 'nom', 'bite', 'punch', 'handhold'
                ];

                if (!args) {
                    return await msg.reply(
                        `🖼️ *Commande .images*\n\n` +
                        `🔍 Recherche n'importe quel personnage :\n` +
                        `• .images naruto\n• .images goku\n• .images luffy\n` +
                        `• .images sasuke\n• .images rem\n• .images mikasa\n\n` +
                        `🐱 Catégories génériques :\n` +
                        `• .images neko / waifu / kitsune\n` +
                        `• .images hug / kiss / cry / pat\n\n` +
                        `_4 sources combinées pour plus de résultats !_`
                    );
                }

                const searchTerm = args.toLowerCase().trim();
                const tag = searchTerm.replace(/ /g, '_');

                try {
                    await msg.reply(`🔍 Recherche de *"${args}"* en cours...`);

                    // --- Lancer toutes les APIs EN PARALLÈLE ---
                    const [
                        nekosResult,
                        waifupicsResult,
                        safebooruResult,
                        gelooburuResult
                    ] = await Promise.allSettled([

                        // API 1 : nekos.best (catégories génériques)
                        NEKOS_CATS.includes(searchTerm)
                            ? axios.get(`https://nekos.best/api/v2/${searchTerm}`, { timeout: 7000 })
                            : Promise.reject('not a nekos category'),

                        // API 2 : waifu.pics (catégories GIF/persos)
                        WAIFUPICS_CATS.includes(searchTerm)
                            ? axios.get(`https://api.waifu.pics/sfw/${searchTerm}`, { timeout: 7000 })
                            : Promise.reject('not a waifu.pics category'),

                        // API 3 : Safebooru (5M+ images taggées par personnage, SFW)
                        axios.get(
                            `https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=50&tags=${encodeURIComponent(tag)}+rating%3Ageneral`,
                            { timeout: 10000 }
                        ),

                        // API 4 : Gelbooru (SFW, encore plus d'images que Safebooru)
                        axios.get(
                            `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&limit=50&tags=${encodeURIComponent(tag)}+rating%3Ageneral`,
                            { timeout: 10000 }
                        )
                    ]);

                    // --- Construire un pool combiné depuis toutes les sources ---
                    const pool = []; // { url, source }

                    // Résultats nekos.best
                    if (nekosResult.status === 'fulfilled') {
                        const results = nekosResult.value.data?.results || [];
                        results.forEach(r => r?.url && pool.push({ url: r.url, source: 'nekos.best' }));
                    }

                    // Résultats waifu.pics
                    if (waifupicsResult.status === 'fulfilled') {
                        const url = waifupicsResult.value.data?.url;
                        if (url) pool.push({ url, source: 'waifu.pics' });
                    }

                    // Résultats Safebooru
                    if (safebooruResult.status === 'fulfilled') {
                        const posts = safebooruResult.value.data;
                        if (Array.isArray(posts)) {
                            posts.forEach(p => {
                                if (p?.directory && p?.image) {
                                    pool.push({
                                        url: `https://safebooru.org/images/${p.directory}/${p.image}`,
                                        source: `Safebooru (${posts.length} résultats)`
                                    });
                                }
                            });
                        }
                    }

                    // Résultats Gelbooru
                    if (gelooburuResult.status === 'fulfilled') {
                        const posts = gelooburuResult.value.data?.post || [];
                        posts.forEach(p => {
                            if (p?.file_url && !p.file_url.endsWith('.mp4') && !p.file_url.endsWith('.webm')) {
                                pool.push({
                                    url: p.file_url,
                                    source: `Gelbooru (${posts.length} résultats)`
                                });
                            }
                        });
                    }

                    // --- Sélection finale ---
                    if (pool.length > 0) {
                        // Choisir une image aléatoire dans le pool combiné
                        const picked = pool[Math.floor(Math.random() * pool.length)];
                        const media = await MessageMedia.fromUrl(picked.url, { unsafeMime: true });
                        await client.sendMessage(msg.from, media, {
                            caption: `🎌 *${args}*\n📦 Pool : ${pool.length} images trouvées\n📡 Source : ${picked.source}`
                        });
                    } else {
                        // Fallback absolu : neko aléatoire
                        const res = await axios.get(`https://nekos.best/api/v2/neko`, { timeout: 8000 });
                        const url = res.data?.results?.[0]?.url;
                        if (url) {
                            const media = await MessageMedia.fromUrl(url, { unsafeMime: true });
                            await client.sendMessage(msg.from, media, {
                                caption: `😅 Aucun résultat pour *"${args}"*. Voici une image aléatoire !`
                            });
                        } else {
                            await msg.reply(`❌ Aucune image trouvée pour *"${args}"*.`);
                        }
                    }

                } catch (e) {
                    logger.error(e);
                    await msg.reply("❌ Erreur lors de la recherche d'image. Réessaie dans quelques secondes.");
                }
                break;

            case '.meto':
                if (!args) return await msg.reply("⚠️ Usage: .meto <ville> (ex: .meto Abidjan)");
                try {
                    const weatherKey = process.env.WEATHERAPI_KEY;
                    if (!weatherKey) return await msg.reply("❌ Erreur : WEATHERAPI_KEY non configurée dans le fichier .env");

                    const res = await axios.get('https://api.weatherapi.com/v1/current.json', {
                        params: { key: weatherKey, q: args, lang: 'fr' },
                        timeout: 8000
                    });

                    const loc = res.data.location;
                    const cur = res.data.current;

                    // Icône selon le code météo
                    const isDay = cur.is_day === 1;
                    const tempIcon = cur.temp_c >= 30 ? '🔥' : cur.temp_c >= 20 ? '🌤️' : cur.temp_c >= 10 ? '🌥️' : '🥶';

                    const meteo =
                        `${tempIcon} *Météo à ${loc.name}, ${loc.country}*\n\n` +
                        `🌡️ Température : *${cur.temp_c}°C* (ressentie ${cur.feelslike_c}°C)\n` +
                        `🌤️ Ciel : ${cur.condition.text}\n` +
                        `💧 Humidité : ${cur.humidity}%\n` +
                        `💨 Vent : ${cur.wind_kph} km/h (${cur.wind_dir})\n` +
                        `👁️ Visibilité : ${cur.vis_km} km\n` +
                        `${isDay ? '☀️ Journée' : '🌙 Nuit'}`;

                    await msg.reply(meteo);
                } catch (e) {
                    logger.error(e);
                    if (e.response?.status === 400) {
                        await msg.reply("❌ Ville introuvable. Vérifie l'orthographe (ex: .meto Abidjan)");
                    } else {
                        await msg.reply("❌ Impossible d'accéder au service météo.");
                    }
                }
                break;

            case '.stik':
                const target = msg.hasQuotedMsg ? await msg.getQuotedMessage() : msg;
                if (target.hasMedia) {
                    try {
                        const media = await target.downloadMedia();
                        await client.sendMessage(msg.from, media, {
                            sendMediaAsSticker: true,
                            stickerAuthor: "ZT Bot",
                            stickerName: args || "ZT Sticker"
                        });
                    } catch (e) {
                        logger.error(e);
                        await msg.reply("❌ Échec de la conversion en sticker. L'image est peut-être trop lourde.");
                    }
                } else {
                    await msg.reply("⚠️ Réponds à une image avec `.stik` pour la transformer en sticker.");
                }
                break;

            case '.dice':
                await msg.reply(`🎲 Le dé donne : *${Math.floor(Math.random() * 6) + 1}*`);
                break;

            default:
                // Commande inconnue : on ne répond pas pour éviter le spam
                break;
        }
    } catch (e) {
        logger.error(e);
        // FIX: msg.reply peut échouer si le message a été supprimé, on ignore l'erreur
        try { await msg.reply("⚠️ Une erreur inattendue s'est produite."); } catch (_) {}
    }
});

// Nettoyage automatique des fichiers temporaires (toutes les heures)
setInterval(() => {
    TEMP_DIRS.forEach(dir => {
        const p = path.join(__dirname, dir);
        if (!fs.existsSync(p)) return;
        fs.readdirSync(p).forEach(file => {
            const fp = path.join(p, file);
            try {
                if ((Date.now() - fs.statSync(fp).mtimeMs) > 3600000) {
                    fs.unlinkSync(fp);
                    logger.info(`🗑️ Fichier temp supprimé : ${fp}`);
                }
            } catch (_) {}
        });
    });
}, 3600000);

// Nettoyage des cooldowns expirés (toutes les 10 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [key, time] of cooldowns.entries()) {
        if (now - time > COOLDOWN_MS) cooldowns.delete(key);
    }
}, 600000);

client.initialize();