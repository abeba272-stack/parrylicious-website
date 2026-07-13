/*
 * Serverseitige, VERTRAUENSWÜRDIGE Service-/Preis-Quelle für Zahlungen.
 * Der öffentliche Checkout-Endpoint darf NIEMALS clientseitig gesendete Beträge
 * verwenden — er schlägt hier per serviceId nach. Muss mit data/services.js
 * (Frontend-Anzeige) synchron gehalten werden; Beträge in EUR.
 */
const SERVICES = {
  dreadlocs_retwist:  { name: 'Dreadlocs – Interlocking / Retwist + Styling', priceFrom: 55,  durationMin: 120, deposit: 30 },
  instant_locs:       { name: 'Häckeln – Instant Locs',                        priceFrom: 100, durationMin: 180, deposit: 40 },
  starter_locs:       { name: 'Starter-Locs (Unisex) + Barrel / Twist / Open', priceFrom: 65,  durationMin: 150, deposit: 35 },
  plain_twist_braids: { name: 'Plain Twist & Braids',                          priceFrom: 60,  durationMin: 120, deposit: 30 },
  comb_twist:         { name: 'Comb Twist',                                    priceFrom: 45,  durationMin: 90,  deposit: 25 },
  cornrows:           { name: 'Cornrows / Twistn´Cornrows',                    priceFrom: 60,  durationMin: 120, deposit: 30 },
  ponytail_europe:    { name: 'Europe Hair Braided Ponytail',                  priceFrom: 65,  durationMin: 120, deposit: 30 },
  ponytail_afrohair:  { name: 'Afrohair Braided Ponytail',                     priceFrom: 65,  durationMin: 120, deposit: 30 },
  half_down_half_up:  { name: 'Half down Half up',                             priceFrom: 70,  durationMin: 150, deposit: 35 },
  braids_feed_in:     { name: 'Braids (Boho) / Feed‑In Cornrows',              priceFrom: 90,  durationMin: 180, deposit: 40 },
  passion_twist:      { name: 'Passion Twist',                                 priceFrom: 110, durationMin: 180, deposit: 40 }
};

function getService(serviceId) {
  const s = SERVICES[String(serviceId || '')];
  return s ? { id: String(serviceId), ...s } : null;
}

module.exports = { SERVICES, getService };
