export type QuestionSetSlug = "cet4" | "cet6" | "tem8" | "ielts" | "toefl";

export type QuestionSeed = {
  id: string;
  zh: string;
  en: string;
  note: "noun" | "verb" | "adjective" | "adverb" | "phrase";
};

export type QuestionSetDefinition = {
  slug: QuestionSetSlug;
  label: string;
  description: string;
};

export const QUESTION_SETS: QuestionSetDefinition[] = [
  {
    slug: "cet4",
    label: "CET-4",
    description: "college core",
  },
  {
    slug: "cet6",
    label: "CET-6",
    description: "advanced college",
  },
  {
    slug: "tem8",
    label: "TEM-8",
    description: "English-major core",
  },
  {
    slug: "ielts",
    label: "IELTS",
    description: "academic and social",
  },
  {
    slug: "toefl",
    label: "TOEFL",
    description: "academic lecture",
  },
];

export function getQuestionSet(slug: string) {
  return QUESTION_SETS.find((set) => set.slug === slug);
}
