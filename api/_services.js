/*
 * Serverseitige, VERTRAUENSWÜRDIGE Service-/Preis-Quelle für Zahlungen.
 * Der öffentliche Checkout-Endpoint darf NIEMALS clientseitig gesendete Beträge
 * verwenden — er schlägt hier per serviceId nach. Muss mit data/services.js
 * (Frontend-Anzeige) synchron gehalten werden; Beträge in EUR.
 * Katalog = 1:1 Spiegel von Salonkee (Preise identisch). deposit = 50 % priceFrom.
 */
// Oberkategorien (Feature 1). Feld `category` + Namen 1:1 gespiegelt aus
// data/services.js (Frontend = Quelle der Wahrheit für die Anzeige). Bei Änderung
// dort MUSS es hier gleich mitgezogen werden. CATEGORY_ORDER = Anzeigereihenfolge.
const CATEGORY_ORDER = [
  'Locs & Dreads', 'Men', 'Braids', 'Wigs & Extensions',
  'Ponytails', 'Wash & Cut', 'Microringe', 'Weft Extensions', 'Treatments', 'Kids'
];

const SERVICES = {
  dreadlocks_retwist:  { name: 'Dreadlocks & Sisterlocs – Re-twist + Styling',              priceFrom: 60,  durationMin: 120, deposit: 30,   category: 'Locs & Dreads' },
  starter_locs:        { name: 'Starterlocks + Styling',                                    priceFrom: 65,  durationMin: 150, deposit: 32.5, category: 'Locs & Dreads' },
  instant_locs:        { name: 'Instant Locs – Crochet / Häckeln',                          priceFrom: 70,  durationMin: 180, deposit: 35,   category: 'Locs & Dreads' },
  braids_twist_men:    { name: 'Braids & Twist (Men)',                                      priceFrom: 60,  durationMin: 90,  deposit: 30,   category: 'Men' },
  cornrows_men:        { name: 'Cornrows & Cornrows into Twist (Men)',                      priceFrom: 60,  durationMin: 90,  deposit: 30,   category: 'Men' },
  braids_boohoo_fulani:{ name: 'Braids – Boohoo / Fulani etc.',                             priceFrom: 140, durationMin: 300, deposit: 70,   category: 'Braids' },
  knotless_braids:     { name: 'Normal Knotless Braids',                                    priceFrom: 130, durationMin: 300, deposit: 65,   category: 'Braids' },
  feed_in_cornrows:    { name: 'Feed-In Cornrows with Extensions',                          priceFrom: 75,  durationMin: 180, deposit: 37.5, category: 'Braids' },
  wig_sew_in:          { name: 'Wig Install – Sew In',                                       priceFrom: 20,  durationMin: 60,  deposit: 10,   category: 'Wigs & Extensions' },
  sleek_pony:          { name: 'Sleek Pony',                                                priceFrom: 60,  durationMin: 90,  deposit: 30,   category: 'Ponytails' },
  half_up_half_down:   { name: 'Half Up, Half Down',                                        priceFrom: 70,  durationMin: 150, deposit: 35,   category: 'Ponytails' },
  wash_blowdry_cut:    { name: 'Wash and Blowdry, Cut',                                     priceFrom: 19,  durationMin: 60,  deposit: 9.5,  category: 'Wash & Cut' },
  curly_cut_wash:      { name: 'Curly Cut & Wash',                                          priceFrom: 45,  durationMin: 75,  deposit: 22.5, category: 'Wash & Cut' },
  wash_cut_european:   { name: 'Wash & Cut – Europäisches Haar',                            priceFrom: 44,  durationMin: 60,  deposit: 22,   category: 'Wash & Cut' },
  microlinks_new:      { name: 'Microlinks – Neuinstallation (Haare nicht inkl.)',          priceFrom: 50,  durationMin: 120, deposit: 25,   category: 'Microringe' },
  microringe_refresh:  { name: 'Microringe Hochsetzen',                                     priceFrom: 35,  durationMin: 90,  deposit: 17.5, category: 'Microringe' },
  treatment_afro:      { name: 'Deep Conditioning – Afro-Haar Treatment',                   priceFrom: 48,  durationMin: 60,  deposit: 24,   category: 'Treatments' },
  treatment_european:  { name: 'Deep Conditioning – Europäisches Haar Treatment',           priceFrom: 48,  durationMin: 60,  deposit: 24,   category: 'Treatments' },
  kids_natural:        { name: 'Natural Hairstyles for Kids',                               priceFrom: 45,  durationMin: 90,  deposit: 22.5, category: 'Kids' },
  weft_beratung:            { name: 'Weft Beratung',                                          priceFrom: 10,  durationMin: 30,  deposit: 5,     category: 'Weft Extensions' },
  weft_liftup_1:            { name: '1 Weft Lift Up',                                         priceFrom: 40,  durationMin: 20,  deposit: 20,    category: 'Weft Extensions' },
  weft_liftup_2:            { name: '2 Weft Lift Up',                                         priceFrom: 80,  durationMin: 45,  deposit: 40,    category: 'Weft Extensions' },
  weft_liftup_3:            { name: '3 Weft Lift Up',                                         priceFrom: 120, durationMin: 70,  deposit: 60,    category: 'Weft Extensions' },
  weft_neu_2reihen:         { name: 'Neue Weft Einarbeitung – 2 Reihen',                      priceFrom: 150, durationMin: 90,  deposit: 75,    category: 'Weft Extensions' },
  weft_neu_3reihen:         { name: 'Neue Weft Einarbeitung – 3 Reihen',                      priceFrom: 205, durationMin: 120, deposit: 102.5, category: 'Weft Extensions' },
  weft_removal:             { name: 'Weft Removal',                                           priceFrom: 40,  durationMin: 30,  deposit: 20,    category: 'Weft Extensions' },
  weft_removal_neu_2reihen: { name: 'Removal + Neue Einarbeitung – 2 Reihen',                 priceFrom: 180, durationMin: 120, deposit: 90,    category: 'Weft Extensions' },
  weft_removal_neu_3reihen: { name: 'Removal + Neue Einarbeitung – 3 Reihen',                 priceFrom: 235, durationMin: 150, deposit: 117.5, category: 'Weft Extensions' },
  weft_wash_styling:        { name: 'Weft – Waschen & Styling',                               priceFrom: 35,  durationMin: 35,  deposit: 17.5,  category: 'Weft Extensions' }
};

function getService(serviceId) {
  const s = SERVICES[String(serviceId || '')];
  return s ? { id: String(serviceId), ...s } : null;
}

// Neukundenrabatt in Prozent (auf den Gesamtpreis der ersten Buchung).
const NEW_CUSTOMER_DISCOUNT_PERCENT = 10;

module.exports = { SERVICES, getService, NEW_CUSTOMER_DISCOUNT_PERCENT, CATEGORY_ORDER };
