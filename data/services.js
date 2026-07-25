// Services basieren auf der aktuellen Salon-Liste. Preise „ab“.
// Quelle: interne Studio-Liste (Parrylicious Hair Artist), pflegbar im Admin-Panel.

export const services = [
  {
    id: "dreadlocs_retwist",
    name: "Dreadlocs – Interlocking / Retwist + Styling",
    category: "Locs & Dreads",
    tags: ["locs"],
    image: "assets/services/dreadlocs_retwist.jpg",
    priceFrom: 55,
    durationMin: 120,
    deposit: 27.5,
    description: "Retwist/Interlocking inkl. Styling – Zusatzkosten bei sehr dickem oder ungekämmtem Haar möglich."
  },
  {
    id: "instant_locs",
    name: "Häckeln – Instant Locs",
    category: "Locs & Dreads",
    tags: ["locs"],
    image: "assets/services/instant_locs.jpg",
    priceFrom: 100,
    durationMin: 180,
    deposit: 50,
    description: "Instant Locs per Häkeltechnik."
  },
  {
    id: "starter_locs",
    name: "Starter-Locs (Unisex) + Barrel / Twist / Open",
    category: "Locs & Dreads",
    tags: ["locs","twists"],
    image: "assets/services/starter_locs.jpg",
    priceFrom: 65,
    durationMin: 150,
    deposit: 32.5,
    description: "Perfekter Start für permanente Locs – Zusatzkosten bei aufwändigem Haarzustand möglich."
  },
  {
    id: "plain_twist_braids",
    name: "Plain Twist & Braids",
    category: "Twists",
    tags: ["twists","braids"],
    image: "assets/services/plain_twist_braids.jpg",
    priceFrom: 60,
    durationMin: 120,
    deposit: 30,
    description: "Klassische Twists/Braids – clean & elegant."
  },
  {
    id: "comb_twist",
    name: "Comb Twist",
    category: "Twists",
    tags: ["twists"],
    image: "assets/services/comb_twist.jpg",
    priceFrom: 45,
    durationMin: 90,
    deposit: 22.5,
    description: "Schneller Twist-Look – ideal für Definition."
  },
  {
    id: "cornrows",
    name: "Cornrows / Twistn´Cornrows",
    category: "Braids",
    tags: ["braids"],
    image: "assets/services/cornrows.jpg",
    priceFrom: 60,
    durationMin: 120,
    deposit: 30,
    description: "Cornrows & Kombi-Styles – je nach Anzahl der Reihen."
  },
  {
    id: "ponytail_europe",
    name: "Europe Hair Braided Ponytail",
    category: "Ponytails",
    tags: ["ponytails","braids"],
    image: "assets/services/ponytail_europe.jpg",
    priceFrom: 65,
    durationMin: 120,
    deposit: 32.5,
    description: "Braided Ponytail mit Europe Hair."
  },
  {
    id: "ponytail_afrohair",
    name: "Afrohair Braided Ponytail",
    category: "Ponytails",
    tags: ["ponytails","braids"],
    image: "assets/services/ponytail_afrohair.jpg",
    priceFrom: 65,
    durationMin: 120,
    deposit: 32.5,
    description: "Braided Ponytail mit Afrohair."
  },
  {
    id: "half_down_half_up",
    name: "Half down Half up",
    category: "Ponytails",
    tags: ["ponytails"],
    image: "assets/services/half_down_half_up.jpg",
    priceFrom: 70,
    durationMin: 150,
    deposit: 35,
    description: "Half up / Half down – elegant, editorial."
  },
  {
    id: "braids_feed_in",
    name: "Braids (Boho) / Feed‑In Cornrows",
    category: "Braids",
    tags: ["braids"],
    image: "assets/services/braids_feed_in.jpg",
    priceFrom: 90,
    durationMin: 180,
    deposit: 45,
    description: "Boho Braids oder Feed‑In Cornrows."
  },
  {
    id: "passion_twist",
    name: "Passion Twist",
    category: "Twists",
    tags: ["twists"],
    image: "assets/services/passion_twist.jpg",
    priceFrom: 110,
    durationMin: 180,
    deposit: 55,
    description: "Passion Twists – weicher, voluminöser Look."
  }
];
