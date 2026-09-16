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

/*
  IMPORTANT :
  Le webhook Stripe doit recevoir le corps brut (raw body).
  On place donc cette route AVANT express.json().
*/

/* =========================================================
   STRIPE WEBHOOK
========================================================= */

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe) {
      return res.status(503).send("Stripe non configuré.");
    }

    const signature = req.headers["stripe-signature"];

    if (!signature) {
      return res.status(400).send("Signature Stripe manquante.");
    }

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      console.log("Événement Stripe reçu :", event.type);

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;

          console.log(
            "Paiement Stripe terminé :",
            session.id,
            "client :",
            session.customer
          );

          /*
            IMPORTANT :
            Ici Stripe confirme que le Checkout est terminé.

            La synchronisation définitive du compte Forma
            sera ajoutée avec l'identifiant du compte utilisateur.
          */

          break;
        }

        case "customer.subscription.updated": {
          const subscription = event.data.object;

          console.log(
            "Abonnement Stripe mis à jour :",
            subscription.id,
            subscription.status
          );

          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object;

          console.log(
            "Abonnement Stripe supprimé :",
            subscription.id
          );

          break;
        }

        default:
          console.log(
            "Événement Stripe ignoré :",
            event.type
          );
      }

      return res.json({ received: true });
    } catch (error) {
      console.error("ERREUR WEBHOOK STRIPE :", error);

      return res.status(400).send(
        `Webhook Stripe invalide : ${error.message}`
      );
    }
  }
);


/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(express.json({ limit: "1mb" }));

app.use(
  express.static(
    path.join(__dirname, "Public")
  )
);


/* =========================================================
   OPENAI
========================================================= */

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  : null;


/* =========================================================
   IA
========================================================= */

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
    title: {
      type: "string"
    },

    subtitle: {
      type: "string"
    },

    subject: {
      type: "string"
    },

    greeting: {
      type: "string"
    },

    contact: {
      type: "array",
      items: {
        type: "string"
      }
    },

    sections: {
      type: "array",

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          heading: {
            type: "string"
          },

          paragraphs: {
            type: "array",
            items: {
              type: "string"
            }
          },

          bullets: {
            type: "array",
            items: {
              type: "string"
            }
          }
        },

        required: [
          "heading",
          "paragraphs",
          "bullets"
        ]
      }
    },

    schedule: {
      type: "array",

      items: {
        type: "object",
        additionalProperties: false,

        properties: {
          day: {
            type: "string"
          },

          time: {
            type: "string"
          },

          task: {
            type: "string"
          },

          priority: {
            type: "string"
          }
        },

        required: [
          "day",
          "time",
          "task",
          "priority"
        ]
      }
    },

    closing: {
      type: "string"
    },

    signature: {
      type: "string"
    }
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


/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(client),
    stripeConfigured: Boolean(stripe)
  });
});


/* =========================================================
   GENERATION IA
========================================================= */

app.post("/api/generate", async (req, res) => {
  try {
    if (!client) {
      return res.status(503).json({
        error:
          "La clé IA n'est pas configurée. Ajoute OPENAI_API_KEY dans les variables d'environnement."
      });
    }

    const {
      tool,
      answers
    } = req.body || {};

    if (!tool || !answers) {
      return res.status(400).json({
        error:
          "Les informations nécessaires sont absentes."
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

    const response =
      await client.responses.create({
        model:
          process.env.OPENAI_MODEL ||
          "gpt-5.6-luna",

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
        error:
          "Aucun résultat texte n'a été renvoyé par l'IA."
      });
    }

    let result;

    try {
      result =
        JSON.parse(response.output_text);
    } catch {
      return res.status(500).json({
        error:
          "Le résultat de l'IA n'est pas un JSON valide."
      });
    }

    return res.json({
      ok: true,
      result
    });

  } catch (error) {
    console.error(
      "ERREUR IA :",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Une erreur est survenue pendant la génération."
    });
  }
});


/* =========================================================
   CREATION CHECKOUT STRIPE
========================================================= */

app.post(
  "/api/create-checkout-session",
  async (req, res) => {
    try {
      if (!stripe) {
        return res.status(503).json({
          error:
            "Stripe n'est pas configuré."
        });
      }

      const {
        plan
      } = req.body || {};

      const prices = {
        Plus:
          process.env.STRIPE_PRICE_PLUS,

        Pro:
          process.env.STRIPE_PRICE_PRO
      };

      const priceId =
        prices[plan];

      if (!priceId) {
        return res.status(400).json({
          error:
            "Plan invalide."
        });
      }

      const session =
        await stripe.checkout.sessions.create({
          mode: "subscription",

          payment_method_types: [
            "card"
          ],

          line_items: [
            {
              price: priceId,
              quantity: 1
            }
          ],

          success_url:
            "https://forma-3j9w.onrender.com?payment=success",

          cancel_url:
            "https://forma-3j9w.onrender.com?payment=cancelled"
        });

      return res.json({
        ok: true,
        url: session.url
      });

    } catch (error) {
      console.error(
        "ERREUR STRIPE :",
        error
      );

      return res.status(500).json({
        error:
          error?.message ||
          "Erreur Stripe."
      });
    }
  }
);


/* =========================================================
   FEEDBACK
========================================================= */

app.post(
  "/api/feedback",
  (req, res) => {
    res.json({
      ok: true
    });
  }
);


/* =========================================================
   PAGE PRINCIPALE
========================================================= */

app.get(
  "/*splat",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "Public",
        "index.html"
      )
    );
  }
);


/* =========================================================
   SERVEUR
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `Forma lancé sur http://localhost:${PORT}`
    );
  }
);
