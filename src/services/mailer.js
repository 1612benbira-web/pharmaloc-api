const { isProduction, mail } = require("../config/env");

let transport = null;
let override = null; // remplaçable UNIQUEMENT par les tests

function getTransport() {
    if (override) return override;
    if (transport) return transport;
    if (!mail.host) return null;
    // nodemailer n'est chargé que si un SMTP est configuré : `npm install nodemailer` n'est requis que pour envoyer pour de vrai.
    const nodemailer = require("nodemailer");
    transport = nodemailer.createTransport({
        host: mail.host,
        port: mail.port,
        secure: mail.port === 465,
        auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined
    });
    return transport;
}

async function send({ to, subject, text }) {
    const t = getTransport();
    if (!t) {
        if (isProduction) throw new Error("Service d'e-mail non configuré (SMTP_HOST)");
        // Développement : le message (donc le lien) s'affiche ici au lieu d'être envoyé.
        console.log(`[e-mail non envoyé : SMTP non configuré]\nÀ : ${to}\nObjet : ${subject}\n${text}\n`);
        return;
    }
    await t.sendMail({ from: mail.from, to, subject, text });
}

const setTransport = (t) => { override = t; };

async function sendPasswordReset({ to, name, link }) {
    await send({
        to,
        subject: "PharmaLoc : réinitialisation de votre mot de passe",
        text: [
            `Bonjour ${name},`,
            "",
            "Vous avez demandé à réinitialiser votre mot de passe PharmaLoc.",
            `Ouvrez ce lien dans les 30 minutes : ${link}`,
            "",
            "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe ne sera pas modifié."
        ].join("\n")
    });
}

module.exports = { send, sendPasswordReset, setTransport };
