export type QuestionSetSlug = "cet4" | "cet6" | "tem8" | "ielts" | "toefl";

export type QuestionSeed = {
  id: string;
  zh: string;
  en: string;
  note: "noun" | "verb" | "adjective";
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
    description: "Core college vocabulary",
    questions: [
      { id: "cet4-1", zh: "环境", en: "environment", note: "noun" },
      { id: "cet4-2", zh: "选择", en: "choice", note: "noun" },
      { id: "cet4-3", zh: "影响", en: "influence", note: "noun" },
      { id: "cet4-4", zh: "责任", en: "responsibility", note: "noun" },
      { id: "cet4-5", zh: "改善", en: "improve", note: "verb" },
      { id: "cet4-6", zh: "可能的", en: "possible", note: "adjective" },
    ],
  },
  {
    slug: "cet6",
    label: "CET-6",
    description: "Advanced college vocabulary",
    questions: [
      { id: "cet6-1", zh: "现象", en: "phenomenon", note: "noun" },
      { id: "cet6-2", zh: "趋势", en: "tendency", note: "noun" },
      { id: "cet6-3", zh: "显著的", en: "significant", note: "adjective" },
      { id: "cet6-4", zh: "促进", en: "facilitate", note: "verb" },
      { id: "cet6-5", zh: "不可避免的", en: "inevitable", note: "adjective" },
      { id: "cet6-6", zh: "分配", en: "allocate", note: "verb" },
    ],
  },
  {
    slug: "tem8",
    label: "TEM-8",
    description: "English-major vocabulary",
    questions: [
      { id: "tem8-1", zh: "模棱两可的", en: "ambiguous", note: "adjective" },
      { id: "tem8-2", zh: "缓解", en: "alleviate", note: "verb" },
      { id: "tem8-3", zh: "连贯的", en: "coherent", note: "adjective" },
      { id: "tem8-4", zh: "脆弱的", en: "vulnerable", note: "adjective" },
      { id: "tem8-5", zh: "推断", en: "infer", note: "verb" },
      { id: "tem8-6", zh: "异常", en: "anomaly", note: "noun" },
    ],
  },
  {
    slug: "ielts",
    label: "IELTS",
    description: "Academic and social topics",
    questions: [
      { id: "ielts-1", zh: "可持续的", en: "sustainable", note: "adjective" },
      { id: "ielts-2", zh: "基础设施", en: "infrastructure", note: "noun" },
      { id: "ielts-3", zh: "多样性", en: "diversity", note: "noun" },
      { id: "ielts-4", zh: "排放", en: "emission", note: "noun" },
      { id: "ielts-5", zh: "城市化", en: "urbanization", note: "noun" },
      { id: "ielts-6", zh: "评估", en: "assess", note: "verb" },
    ],
  },
  {
    slug: "toefl",
    label: "TOEFL",
    description: "Academic lecture vocabulary",
    questions: [
      { id: "toefl-1", zh: "假设", en: "hypothesis", note: "noun" },
      { id: "toefl-2", zh: "光合作用", en: "photosynthesis", note: "noun" },
      { id: "toefl-3", zh: "沉积物", en: "sediment", note: "noun" },
      { id: "toefl-4", zh: "迁徙", en: "migration", note: "noun" },
      { id: "toefl-5", zh: "侵蚀", en: "erosion", note: "noun" },
      { id: "toefl-6", zh: "使适应", en: "adapt", note: "verb" },
    ],
  },
];

export function getQuestionSet(slug: string) {
  return QUESTION_SETS.find((set) => set.slug === slug);
}
