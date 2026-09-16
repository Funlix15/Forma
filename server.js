import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";
import Stripe from "stripe";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "Public")));

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const AI_RULES = `
Tu es l'IA rédactionnelle de Forma.

Tu transformes les réponses brutes de l'utilisateur en un résultat final
réellement rédigé, naturel, clair, structuré et directement utilisable.

REGLES :
- Ne fais jamais une simple correction orthographique.
- Comprends l'intention avant de rédiger.
- Reformule complètement les informations descriptives.
- Développe seulement lorsque les informations fournies le permettent.
- N'invente jamais de diplôme, expérience, compétence, qualité, entreprise,
  école, date, métier ou événement.
- Les noms, prénoms, entreprises, écoles, dates, lieux et coordonnées peuvent
  rester exactement tels qu'ils ont été fournis.
- Si une information manque, ne l'invente pas.
- Le résultat doit être naturel et crédible.
- Adapte le vocabulaire à l'outil.

CV :
- CV professionnel, synthétique et lisible.
- Sections uniquement lorsqu'elles sont pertinentes.
- Une expérience doit être reformulée en contenu professionnel sans invention.
- Si aucune expérience n'existe, n'en invente aucune.
- Pour un élève, adapte correctement le niveau scolaire.
- Si une date de naissance est fournie, elle peut servir à calculer l'âge.

LETTRE :
- Courte et naturelle.
- Présente le contexte, la motivation et les éléments pertinents.
- Termine proprement.

MESSAGE :
- Comprends l'objectif réel.
- Ne recopie pas la phrase de départ.
- Pour un message professionnel, ajoute un objet de 5 à 8 mots si pertinent.
- Formule d'appel.
- Corps clair.
- Appel à l'action si nécessaire.
- Formule de politesse.
- Signature si le prénom et le nom sont disponibles.

PRESENTATION :
- Texte naturel et fluide.
- Sélectionne les informations pertinentes.

OBJECTIFS :
- Transforme les idées en objectifs clairs et réalistes.
- N'invente pas de contraintes.

MOTIVATION :
- Texte personnalisé et naturel.
- N'invente pas de situation.

PLANNING :
- Organise uniquement les horaires, tâches et contraintes fournis.
- N'invente jamais d'horaire.
`;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    subject: { type: "string" },
    greeting: { type: "string" },
    contact: {
      type: "array",
      items: { type: "string" }
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: { type: "string" },
          paragraphs: {
            type: "array",
            items: { type: "string" }
          },
          bullets: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["heading", "paragraphs", "bullets"]
      }
    },
    schedule: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          day: { type: "string" },
          time: { type: "string" },
          task: { type: "string" },
          priority: { type: "string" }
        },
        required: ["day", "time", "task", "priority"]
      }
    },
    closing: { type: "string" },
    signature: { type: "string" }
  },
  required: [
    "title",
    "subtitle",
    "subject",
    "greeting",
    "contact",
    "sections",
    "schedule",
    "closing",
    "signature"
  ]
};

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(client)
  });
});

app.post("/api/generate", async (req, res) => {
  try {
    if (!client) {
      return res.status(503).json({
        error:
          "La clé IA n'est pas configurée. Ajoute OPENAI_API_KEY dans .env."
      });
    }

    const { tool, answers } = req.body || {};

    if (!tool || !answers) {
      return res.status(400).json({
        error: "Les informations nécessaires sont absentes."
      });
    }

    const input = JSON.stringify(
      {
        outil: tool,
        réponses: answers
      },
      null,
      2
    );

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      instructions: AI_RULES,
      input: `
Voici les réponses brutes de l'utilisateur.

${input}

Analyse-les réellement puis rédige le résultat final.
Retourne uniquement les données correspondant au schéma.
`,
      text: {
        format: {
          type: "json_schema",
          name: "forma_result",
          strict: true,
          schema: OUTPUT_SCHEMA
        }
      }
    });

    if (!response.output_text) {
      return res.status(500).json({
        error: "Aucun résultat texte n'a été renvoyé par l'IA."
      });
    }

    let result;

    try {
      result = JSON.parse(response.output_text);
    } catch {
      return res.status(500).json({
        error: "Le résultat de l'IA n'est pas un JSON valide."
      });
    }

    return res.json({
      ok: true,
      result
    });
  } catch (error) {
    console.error("ERREUR IA :", error);

    return res.status(500).json({
      error:
        error?.message ||
        "Une erreur est survenue pendant la génération."
    });
  }
});
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({
        error: "Stripe n'est pas configuré."
      });
    }

    const { plan } = req.body || {};

    const prices = {
      Plus: process.env.STRIPE_PRICE_PLUS,
      Pro: process.env.STRIPE_PRICE_PRO
    };

    const priceId = prices[plan];

    if (!priceId) {
      return res.status(400).json({
        error: "Plan invalide."
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      success_url: "https://forma-3j9w.onrender.com?payment=success",
      cancel_url: "https://forma-3j9w.onrender.com?payment=cancelled"
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("ERREUR STRIPE :", error);

    res.status(500).json({
      error: error?.message || "Erreur Stripe."
    });
  }
});

app.post("/api/feedback", (req, res) => {
  res.json({ ok: true });
});

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "Public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Forma lancé sur http://localhost:${PORT}`);
});
