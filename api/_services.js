/*
 * Serverseitige, VERTRAUENSWÜRDIGE Service-/Preis-Quelle für Zahlungen.
 * Der öffentliche Checkout-Endpoint darf NIEMALS clientseitig gesendete Beträge
 * verwenden — er schlägt hier per serviceId nach. Muss mit data/services.js
 * (Frontend-Anzeige) synchron gehalten werden; Beträge in EUR.
 * Katalog = 1:1 Spiegel von Salonkee (Preise identisch). deposit = 50 % priceFrom.
 */
// Oberkategorien (Feature 1). Namen zentral hier, damit data/services.js (Frontend)
// exakt dieselben Gruppen spiegeln kann. GROUP_ORDER = Reihenfolge in der Anzeige.
const GROUPS = {
  LOCS: 'Locs & Braids',
  PONY: 'Ponytails & Styling',
  WASH: 'Wash, Cut & Treatment',
  EXT: 'Extensions & Wigs',
  KIDS: 'Kids'
};
const GROUP_ORDER = [GROUPS.LOCS, GROUPS.PONY, GROUPS.EXT, GROUPS.WASH, GROUPS.KIDS];

const SERVICES = {
  dreadlocks_retwist:  { name: 'Dreadlocks & Sisterlocs – Re-twist + Styling',              priceFrom: 60,  durationMin: 120, deposit: 30,   group: GROUPS.LOCS },
  starter_locs:        { name: 'Starterlocks + Styling',                                    priceFrom: 65,  durationMin: 150, deposit: 32.5, group: GROUPS.LOCS },
  instant_locs:        { name: 'Instant Locs – Crochet / Häckeln',                          priceFrom: 70,  durationMin: 180, deposit: 35,   group: GROUPS.LOCS },
  braids_twist_men:    { name: 'Braids & Twist (Men)',                                      priceFrom: 60,  durationMin: 90,  deposit: 30,   group: GROUPS.LOCS },
  cornrows_men:        { name: 'Cornrows & Cornrows into Twist (Men)',                      priceFrom: 60,  durationMin: 90,  deposit: 30,   group: GROUPS.LOCS },
  braids_boohoo_fulani:{ name: 'Braids – Boohoo / Fulani etc.',                             priceFrom: 140, durationMin: 300, deposit: 70,   group: GROUPS.LOCS },
  knotless_braids:     { name: 'Normal Knotless Braids',                                    priceFrom: 130, durationMin: 300, deposit: 65,   group: GROUPS.LOCS },
  feed_in_cornrows:    { name: 'Feed-In Cornrows with Extensions',                          priceFrom: 75,  durationMin: 180, deposit: 37.5, group: GROUPS.LOCS },
  wig_sew_in:          { name: 'Wig Install – Sew In',                                       priceFrom: 20,  durationMin: 60,  deposit: 10,   group: GROUPS.EXT },
  sleek_pony:          { name: 'Sleek Pony',                                                priceFrom: 60,  durationMin: 90,  deposit: 30,   group: GROUPS.PONY },
  half_up_half_down:   { name: 'Half Up, Half Down',                                        priceFrom: 70,  durationMin: 150, deposit: 35,   group: GROUPS.PONY },
  wash_blowdry_cut:    { name: 'Wash and Blowdry, Cut',                                     priceFrom: 19,  durationMin: 60,  deposit: 9.5,  group: GROUPS.WASH },
  curly_cut_wash:      { name: 'Curly Cut & Wash',                                          priceFrom: 45,  durationMin: 75,  deposit: 22.5, group: GROUPS.WASH },
  wash_cut_european:   { name: 'Wash & Cut – Europäisches Haar',                            priceFrom: 44,  durationMin: 60,  deposit: 22,   group: GROUPS.WASH },
  microlinks_new:      { name: 'Microlinks – Neuinstallation (Haare nicht inkl.)',          priceFrom: 50,  durationMin: 120, deposit: 25,   group: GROUPS.EXT },
  microringe_refresh:  { name: 'Microringe Hochsetzen',                                     priceFrom: 35,  durationMin: 90,  deposit: 17.5, group: GROUPS.EXT },
  treatment_afro:      { name: 'Deep Conditioning – Afro-Haar Treatment',                   priceFrom: 48,  durationMin: 60,  deposit: 24,   group: GROUPS.WASH },
  treatment_european:  { name: 'Deep Conditioning – Europäisches Haar Treatment',           priceFrom: 48,  durationMin: 60,  deposit: 24,   group: GROUPS.WASH },
  kids_natural:        { name: 'Natural Hairstyles for Kids',                               priceFrom: 45,  durationMin: 90,  deposit: 22.5, group: GROUPS.KIDS }
};

function getService(serviceId) {
  const s = SERVICES[String(serviceId || '')];
  return s ? { id: String(serviceId), ...s } : null;
}

// Neukundenrabatt in Prozent (auf den Gesamtpreis der ersten Buchung).
const NEW_CUSTOMER_DISCOUNT_PERCENT = 10;

module.exports = { SERVICES, getService, NEW_CUSTOMER_DISCOUNT_PERCENT, GROUPS, GROUP_ORDER };
