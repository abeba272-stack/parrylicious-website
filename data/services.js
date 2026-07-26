// Services = 1:1 Spiegel des Salonkee-Katalogs (Parrylicious Hair Artist).
// Preise „ab", identisch zu Salonkee. Anzahlung (deposit) = 50 % von priceFrom.
// durationMin = Richtwert (Salonkee zeigt die Dauer nur beim Auswählen) —
// von Heike zu bestätigen/korrigieren.
// category ist vorläufig — Über-/Untergruppen werden fachlich noch geklärt.
// Bilder: viele neue Styles nutzen assets/placeholder-editorial.jpg als Platzhalter.
//
// WICHTIG: bei jeder Änderung api/_services.js synchron halten (server-seitige
// Preis-/Anzahlungs-Quelle für Stripe).

export const services = [
  {
    id: "dreadlocks_retwist",
    name: "Dreadlocks & Sisterlocs – Re-twist + Styling",
    category: "Locs & Dreads",
    tags: ["locs"],
    image: "assets/services/dreadlocs_retwist.jpg",
    priceFrom: 60,
    durationMin: 120,
    deposit: 30,
    description: "Re-twist / Interlocking inkl. Styling für Dreadlocks & Sisterlocs (Repair). Zusatzkosten bei sehr dickem oder ungekämmtem Haar möglich."
  },
  {
    id: "starter_locs",
    name: "Starterlocks + Styling",
    category: "Locs & Dreads",
    tags: ["locs"],
    image: "assets/services/starter_locs.jpg",
    priceFrom: 65,
    durationMin: 150,
    deposit: 32.5,
    description: "Perfekter Start für permanente Locs inkl. Styling. Zusatzkosten bei aufwändigem Haarzustand möglich."
  },
  {
    id: "instant_locs",
    name: "Instant Locs – Crochet / Häckeln",
    category: "Locs & Dreads",
    tags: ["locs"],
    image: "assets/services/instant_locs.jpg",
    priceFrom: 70,
    durationMin: 180,
    deposit: 35,
    description: "Instant Locs per Häkel-/Crochet-Technik."
  },
  {
    id: "braids_twist_men",
    name: "Braids & Twist (Men)",
    category: "Men",
    tags: ["braids", "twists", "men"],
    image: "assets/services/plain_twist_braids.jpg",
    priceFrom: 60,
    durationMin: 90,
    deposit: 30,
    description: "Braids- oder Twist-Styles für Herren."
  },
  {
    id: "cornrows_men",
    name: "Cornrows & Cornrows into Twist (Men)",
    category: "Men",
    tags: ["braids", "cornrows", "men"],
    image: "assets/services/cornrows.jpg",
    priceFrom: 60,
    durationMin: 90,
    deposit: 30,
    description: "Cornrows oder Cornrows-into-Twist für Herren – je nach Anzahl der Reihen."
  },
  {
    id: "braids_boohoo_fulani",
    name: "Braids – Boohoo / Fulani etc.",
    category: "Braids",
    tags: ["braids"],
    image: "assets/placeholder-editorial.jpg",
    priceFrom: 140,
    durationMin: 300,
    deposit: 70,
    description: "Boohoo-, Fulani- und weitere Braid-Styles inkl. Extensions."
  },
  {
    id: "knotless_braids",
    name: "Normal Knotless Braids",
    category: "Braids",
    tags: ["braids"],
    image: "assets/placeholder-editorial.jpg",
    priceFrom: 130,
    durationMin: 300,
    deposit: 65,
    description: "Klassische Knotless Braids inkl. Extensions."
  },
  {
    id: "feed_in_cornrows",
    name: "Feed-In Cornrows with Extensions",
    category: "Braids",
    tags: ["braids", "cornrows"],
    image: "assets/services/braids_feed_in.jpg",
    priceFrom: 75,
    durationMin: 180,
    deposit: 37.5,
    description: "Feed-In Cornrows mit Extensions."
  },
  {
    id: "wig_sew_in",
    name: "Wig Install – Sew In",
    category: "Wigs & Extensions",
    tags: ["wig", "extensions"],
    image: "assets/placeholder-editorial.jpg",
    priceFrom: 20,
    durationMin: 60,
    deposit: 10,
    description: "Wig-Install bzw. Sew-In / Perücken-Anfertigung."
  },
  {
    id: "sleek_pony",
    name: "Sleek Pony",
    category: "Ponytails",
    tags: ["ponytails"],
    image: "assets/services/ponytail_europe.jpg",
    priceFrom: 60,
    durationMin: 90,
    deposit: 30,
    description: "Sleek Ponytail – clean & elegant."
  },
  {
    id: "half_up_half_down",
    name: "Half Up, Half Down",
    category: "Ponytails",
    tags: ["ponytails"],
    image: "assets/services/half_down_half_up.jpg",
    priceFrom: 70,
    durationMin: 150,
    deposit: 35,
    description: "Half Up / Half Down – elegant, editorial."
  },
  {
    id: "wash_blowdry_cut",
    name: "Wash and Blowdry, Cut",
    category: "Wash & Cut",
    tags: ["wash", "cut"],
    image: "assets/placeholder-editorial.jpg",
    priceFrom: 19,
    durationMin: 60,
    deposit: 9.5,
    description: "Waschen, Föhnen und Schnitt."
  },
  {
    id: "curly_cut_wash",
    name: "Curly Cut & Wash",
    category: "Wash & Cut",
    tags: ["wash", "cut", "curly"],
    image: "assets/placeholder-editorial.jpg",
    priceFrom: 45,
    durationMin: 75,
    deposit: 22.5,
    description: "Curly Cut inkl. Wäsche – für definierte Locken."
  },
  {
    id: "wash_cut_european",
    name: "Wash & Cut – Europäisches Haar",
    category: "Wash & Cut",
    tags: ["wash", "cut"],
    image: "assets/placeholder-editorial.jpg",
    priceFrom: 44,
    durationMin: 60,
    deposit: 22,
    description: "Waschen und Schnitt für europäisches Haar."
  },
  {
    id: "microlinks_new",
    name: "Microlinks – Neuinstallation (Haare nicht inkl.)",
    category: "Microringe",
    tags: ["extensions", "microringe"],
    image: "assets/placeholder-editorial.jpg",
    priceFrom: 50,
    durationMin: 120,
    deposit: 25,
    description: "Microlinks-Neuinstallation. Haare sind nicht im Preis enthalten."
  },
  {
    id: "microringe_refresh",
    name: "Microringe Hochsetzen",
    category: "Microringe",
    tags: ["extensions", "microringe"],
    image: "assets/placeholder-editorial.jpg",
    priceFrom: 35,
    durationMin: 90,
    deposit: 17.5,
    description: "Hochsetzen / Refresh bestehender Microringe."
  },
  {
    id: "treatment_afro",
    name: "Deep Conditioning – Afro-Haar Treatment",
    category: "Treatments",
    tags: ["treatment"],
    image: "assets/placeholder-editorial.jpg",
    priceFrom: 48,
    durationMin: 60,
    deposit: 24,
    description: "Deep-Conditioning-Treatment für afro-texturiertes Haar."
  },
  {
    id: "treatment_european",
    name: "Deep Conditioning – Europäisches Haar Treatment",
    category: "Treatments",
    tags: ["treatment"],
    image: "assets/placeholder-editorial.jpg",
    priceFrom: 48,
    durationMin: 60,
    deposit: 24,
    description: "Deep-Conditioning-Treatment für europäisches Haar."
  },
  {
    id: "kids_natural",
    name: "Natural Hairstyles for Kids",
    category: "Kids",
    tags: ["kids"],
    image: "assets/placeholder-editorial.jpg",
    priceFrom: 45,
    durationMin: 90,
    deposit: 22.5,
    description: "Natürliche Frisuren für Kinder."
  }
];
