import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2026-01-28.clover",
});

export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "";
export const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
export const STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET || "";