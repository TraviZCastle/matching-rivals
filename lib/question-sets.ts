import { QUESTION_BANKS } from "@/lib/question-bank-data.generated";

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
  questions: QuestionSeed[];
};

export const QUESTION_SETS: QuestionSetDefinition[] = [
  {
    slug: "cet4",
    label: "CET-4",
    description: "500-word college core",
    questions: [...QUESTION_BANKS.cet4],
  },
  {
    slug: "cet6",
    label: "CET-6",
    description: "500-word advanced college",
    questions: [...QUESTION_BANKS.cet6],
  },
  {
    slug: "tem8",
    label: "TEM-8",
    description: "500-word English-major core",
    questions: [...QUESTION_BANKS.tem8],
  },
  {
    slug: "ielts",
    label: "IELTS",
    description: "500-word academic and social",
    questions: [...QUESTION_BANKS.ielts],
  },
  {
    slug: "toefl",
    label: "TOEFL",
    description: "500-word academic lecture",
    questions: [...QUESTION_BANKS.toefl],
  },
];

export function getQuestionSet(slug: string) {
  return QUESTION_SETS.find((set) => set.slug === slug);
}
