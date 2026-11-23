import type { CategorySlug } from "./categories";

/**
 * Best-guess category for a product name nobody has categorised yet.
 *
 * Before this, an untouched selector filed every new item under `pantry`, and production data showed
 * half the kitchen there — milk, spinach and onions included — with no expiry estimate as a result.
 * The guess is silent: it only pre-fills the selector (and the stored category for a list add), and
 * the category tag on every row makes a wrong guess visible and one tap to fix.
 *
 * A keyword table rather than a model call: adding an item must stay instant and free, and work
 * when OpenAI is down. Vocabulary covers what a vegetarian Indian household in the US buys, Hindi
 * and English names both (palak and spinach, kabuli chana and garbanzo).
 *
 * Matching: the name and every keyword are lowercased, accent-stripped and singularised word by
 * word, then a keyword matches when its words appear consecutively in the name. The longest match
 * wins, so "coconut milk" beats "milk" and "garlic bread" beats "garlic". Ties go to the category
 * that describes the finished product rather than an ingredient, so "tomato soup" is pantry and
 * "garlic naan cracker" is a snack — see `TIE_PRIORITY`.
 */
const KEYWORDS: Record<CategorySlug, readonly string[]> = {
  produce: [
    "onion", "pyaaz", "potato", "aloo", "tomato", "tamatar", "garlic", "lahsun", "ginger", "adrak",
    "green chili", "green chilli", "hari mirch", "jalapeno", "cilantro", "coriander leaves", "dhaniya",
    "mint", "pudina", "curry leaves", "kadi patta", "methi", "palak", "spinach", "bhindi", "okra",
    "karela", "bitter gourd", "lauki", "bottle gourd", "tinda", "arbi", "taro", "baingan", "eggplant",
    "brinjal", "cauliflower", "gobi", "cabbage", "capsicum", "bell pepper", "carrot", "gajar",
    "cucumber", "kheera", "green bean", "broccoli", "mushroom", "zucchini", "squash", "pumpkin",
    "sweet potato", "shakarkandi", "pea", "matar", "lemon", "lime", "nimbu", "banana", "kela", "apple",
    "mango", "aam", "grape", "orange", "papaya", "pomegranate", "anar", "guava", "amrood",
    "blueberry", "strawberry", "blackberry", "raspberry", "avocado", "kiwi", "pear", "peach", "plum",
    "watermelon", "melon", "pineapple", "coconut", "basil", "lettuce", "salad", "kale", "celery",
    "radish", "mooli", "beetroot", "beet", "drumstick", "scallion", "spring onion", "shallot", "dill",
    "corn", "bhutta", "fruit", "vegetable", "veggie",
  ],
  dairy: [
    "milk", "doodh", "curd", "dahi", "yogurt", "yoghurt", "paneer", "ghee", "butter", "cheese",
    "cheddar", "mozzarella", "parmesan", "ricotta", "feta", "pepper jack", "cream", "malai", "khoya",
    "khoa", "mawa", "buttermilk", "chaas", "lassi", "egg", "tofu", "tempeh", "sour cream",
    "half and half", "creamer", "shrikhand", "milk powder",
  ],
  baked: [
    "bread", "naan", "pav", "bun", "bagel", "tortilla", "pita", "croissant", "focaccia", "muffin",
    "cake", "tiramisu", "kulcha", "bao", "brioche", "loaf", "pastry",
  ],
  frozen: [
    "frozen", "ice cream", "icecream", "kulfi", "edamame", "gyoza", "dumpling", "momo", "spring roll",
    "hash brown", "patty", "nugget", "pizza", "ravioli", "risotto", "burger", "acai", "popsicle",
  ],
  dals: [
    "dal", "daal", "dhal", "lentil", "toor", "arhar", "moong", "mung", "urad", "masoor", "chana",
    "chole", "kabuli chana", "chickpea", "garbanzo", "rajma", "kidney bean", "bean", "lobia",
    "black eyed pea", "horse gram", "kulthi", "matki", "moth", "soya chunk", "soy chunk",
  ],
  grains: [
    "atta", "flour", "besan", "jowar", "bajra", "ragi", "maida", "rice", "chawal", "basmati", "poha",
    "sooji", "suji", "rava", "semolina", "dalia", "oat", "quinoa", "couscous", "pasta", "spaghetti",
    "penne", "macaroni", "noodle", "vermicelli", "seviyan", "millet", "barley", "sabudana", "sago",
  ],
  spices: [
    "masala", "garam masala", "haldi", "turmeric", "jeera", "cumin", "rai", "mustard seed",
    "methi seed", "kasuri methi", "kastoori methi", "hing", "asafoetida", "ajwain", "saunf", "fennel",
    "elaichi", "cardamom", "cardamon", "clove", "laung", "cinnamon", "dalchini", "bay leaf",
    "tej patta", "kesar", "saffron", "chili powder", "chilli powder", "red chili", "kashmiri",
    "black pepper", "peppercorn", "salt", "namak", "chaat masala", "oregano", "paprika", "allspice",
    "nutmeg", "jaiphal", "star anise", "amchur", "coriander powder", "dhania powder", "powder",
    "seasoning", "fajita mix", "taco seasoning", "spice", "curry powder",
  ],
  condiments: [
    "ketchup", "sauce", "soy sauce", "chutney", "achar", "pickle", "mayo", "mayonnaise", "mustard",
    "dressing", "vinegar", "sriracha", "salsa", "jam", "honey", "syrup", "spread", "glaze", "hummus",
    "bouillon", "paste", "tamarind", "imli", "pesto", "marinara", "olive", "peanut butter",
    "lemon juice", "dip",
  ],
  nuts: [
    "badam", "almond", "kaju", "cashew", "pista", "pistachio", "walnut", "akhrot", "raisin",
    "kishmish", "date", "khajur", "medjool", "fig", "anjeer", "apricot", "makhana", "fox nut",
    "peanut", "moongphali", "flax", "chia", "seed", "pine nut", "trail mix", "dry fruit",
    "shredded coconut", "desiccated coconut", "nut",
  ],
  snacks: [
    "chip", "namkeen", "bhujia", "sev", "mixture", "chakli", "mathri", "khakhra", "papad", "biscuit",
    "cookie", "cracker", "rusk", "chocolate", "candy", "mithai", "laddu", "ladoo", "barfi", "burfi",
    "son papdi", "soan papdi", "chikki", "gajak", "granola", "bar", "popcorn", "pretzel", "murmura",
    "puffed rice", "puff rice", "boondi", "roasted chickpea", "dhana dal", "dhana daal", "veggie straw", "puri",
    "pudding", "breadstick", "crepe", "espresso bean", "gulab jamun", "rasgulla", "halwa",
  ],
  beverages: [
    "chai", "tea", "coffee", "juice", "soda", "coke", "pepsi", "sprite", "water", "sparkling", "wine",
    "beer", "kombucha", "matcha", "horlicks", "bournvita", "rooh afza", "coconut water", "drink",
  ],
  pantry: [
    "oil", "sugar", "jaggery", "gur", "baking soda", "baking powder", "yeast", "cocoa", "vanilla",
    "sweetener", "condensed milk", "evaporated milk", "coconut milk", "maggi", "instant noodle",
    "ramen", "soup", "ready to eat", "curry", "cornstarch", "corn flour", "corn starch", "breadcrumb",
    "cereal", "cornflake", "muesli", "waffle mix", "pancake mix", "cake mix", "choco chip",
    "chocolate chip",
  ],
  household: [
    "detergent", "soap", "shampoo", "conditioner", "toothpaste", "toothbrush", "tissue",
    "paper towel", "toilet paper", "trash bag", "garbage bag", "foil", "cling wrap", "plastic wrap",
    "sponge", "dish", "cleaner", "bleach", "glue", "battery", "bulb", "bedsheet", "towel", "diaper",
    "ziploc", "napkin", "lotion", "deodorant", "razor", "floss", "mouthwash", "candle", "agarbatti",
  ],
};

/**
 * Tie-break for equal-length matches: product kinds before ingredient kinds. "tomato soup" is soup,
 * "rice vinegar" is vinegar, "mushroom ravioli" is frozen ravioli, "cream cheese" is still dairy.
 */
const TIE_PRIORITY: readonly CategorySlug[] = [
  "household", "frozen", "beverages", "snacks", "condiments", "pantry", "baked", "spices", "grains",
  "dals", "nuts", "dairy", "produce",
];

function singular(word: string): string {
  if (word.length > 3 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("oes")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map(singular);
}

type Rule = { words: string[]; category: CategorySlug; rank: number };

const RULES: Rule[] = Object.entries(KEYWORDS).flatMap(([category, keywords]) =>
  keywords.map((keyword) => ({
    words: words(keyword),
    category: category as CategorySlug,
    rank: TIE_PRIORITY.indexOf(category as CategorySlug),
  })),
);

function containsRun(haystack: string[], needle: string[]): boolean {
  outer: for (let start = 0; start + needle.length <= haystack.length; start++) {
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) continue outer;
    }
    return true;
  }
  return false;
}

/** The suggested category, or null when no keyword matches (the caller decides the fallback). */
export function suggestCategory(name: string): CategorySlug | null {
  const nameWords = words(name);
  let best: Rule | null = null;
  for (const rule of RULES) {
    if (!containsRun(nameWords, rule.words)) continue;
    if (
      best === null ||
      rule.words.length > best.words.length ||
      (rule.words.length === best.words.length && rule.rank < best.rank)
    ) {
      best = rule;
    }
  }
  return best?.category ?? null;
}
