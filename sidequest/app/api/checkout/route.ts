import { NextResponse } from 'next/server';
import Stripe from 'stripe';

// Hier holt sich der Server deinen geheimen Stripe-Schlüssel
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover', // Aktuelle Stripe Version
});

export async function POST(request: Request) {
  try {
    const { userId, priceId } = await request.json();

    // Wir sagen Stripe: Mach eine neue Kasse auf!
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'paypal'], // Was wir akzeptieren
      line_items: [
        {
          price: priceId, // Das ist deine Produkt-ID von vorhin
          quantity: 1,
        },
      ],
      mode: 'payment',
      // Wohin soll der User nach dem Bezahlen geschickt werden?
      success_url: `${request.headers.get('origin')}/?success=true`,
      cancel_url: `${request.headers.get('origin')}/?canceled=true`,
      client_reference_id: userId,
    });

    // Wir schicken die URL der fertigen Kasse an die App zurück
    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}