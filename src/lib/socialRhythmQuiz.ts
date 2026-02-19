export type QuizAnswer = "A" | "B" | "C";

export type QuizAnswersByQuestion = {
  Q1: QuizAnswer;
  Q2: QuizAnswer;
  Q3: QuizAnswer;
  Q4: QuizAnswer;
  Q5: QuizAnswer;
  Q6: QuizAnswer;
  Q7: QuizAnswer;
  Q8: QuizAnswer;
};

export type QuizNumericScores = {
  Q1: number;
  Q2: number;
  Q3: number;
  Q4: number;
  Q5: number;
  Q6: number;
  Q7: number;
  Q8: number;
};

export type QuizDimensions = {
  stim: number;
  group_size: number;
  endurance: number;
  structure: number;
  connection: number;
};

export type QuizDimensionLabels = {
  stim: "Calm" | "Balanced" | "Lively";
  group_size: "Small groups" | "Medium groups" | "Large groups";
  endurance: "Short meetups" | "Medium length" | "Long meetups";
  structure: "Structured" | "Flexible" | "Spontaneous";
  connection: "Deep" | "Balanced" | "Light & playful";
};

export type SocialRhythmResult = {
  user_id: string | null;
  timestamp: string;
  raw_answers: QuizAnswersByQuestion;
  numeric_scores: QuizNumericScores;
  dimensions: QuizDimensions;
  labels: QuizDimensionLabels;
  summary: {
    group_size: QuizDimensionLabels["group_size"];
    energy: QuizDimensionLabels["stim"];
    meetup_length: QuizDimensionLabels["endurance"];
    planning: QuizDimensionLabels["structure"];
    conversation: QuizDimensionLabels["connection"];
  };
  style: string;
  label: string;
  quiz_version: "social_rhythm_v1";
};

export function scoreAnswer(answer: QuizAnswer): number {
  if (answer === "A") return 0;
  if (answer === "B") return 50;
  return 100;
}

function roundInt(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function toBand(value: number): "low" | "medium" | "high" {
  if (value <= 33) return "low";
  if (value <= 66) return "medium";
  return "high";
}

function stimLabel(value: number): QuizDimensionLabels["stim"] {
  const band = toBand(value);
  if (band === "low") return "Calm";
  if (band === "medium") return "Balanced";
  return "Lively";
}

function groupLabel(value: number): QuizDimensionLabels["group_size"] {
  const band = toBand(value);
  if (band === "low") return "Small groups";
  if (band === "medium") return "Medium groups";
  return "Large groups";
}

function enduranceLabel(value: number): QuizDimensionLabels["endurance"] {
  const band = toBand(value);
  if (band === "low") return "Short meetups";
  if (band === "medium") return "Medium length";
  return "Long meetups";
}

function structureLabel(value: number): QuizDimensionLabels["structure"] {
  const band = toBand(value);
  if (band === "low") return "Structured";
  if (band === "medium") return "Flexible";
  return "Spontaneous";
}

function connectionLabel(value: number): QuizDimensionLabels["connection"] {
  const band = toBand(value);
  if (band === "low") return "Deep";
  if (band === "medium") return "Balanced";
  return "Light & playful";
}

function deriveStyle(labels: QuizDimensionLabels): string {
  const livelyCount = [
    labels.stim === "Lively",
    labels.group_size === "Large groups",
    labels.endurance === "Long meetups",
    labels.structure === "Spontaneous",
    labels.connection === "Light & playful",
  ].filter(Boolean).length;
  const calmCount = [
    labels.stim === "Calm",
    labels.group_size === "Small groups",
    labels.endurance === "Short meetups",
    labels.structure === "Structured",
    labels.connection === "Deep",
  ].filter(Boolean).length;

  if (livelyCount >= 3) return "Social Spark";
  if (calmCount >= 3) return "Deep Connector";
  return "Balanced Connector";
}

export function isQuizCompleteByResponses(responses: Record<number, QuizAnswer>): boolean {
  for (let q = 1; q <= 8; q += 1) {
    const v = responses[q];
    if (v !== "A" && v !== "B" && v !== "C") return false;
  }
  return true;
}

export function responsesToAnswersObject(
  responses: Record<number, QuizAnswer>
): QuizAnswersByQuestion | null {
  if (!isQuizCompleteByResponses(responses)) return null;
  return {
    Q1: responses[1],
    Q2: responses[2],
    Q3: responses[3],
    Q4: responses[4],
    Q5: responses[5],
    Q6: responses[6],
    Q7: responses[7],
    Q8: responses[8],
  };
}

export function computeSocialRhythmResult(
  answers: QuizAnswersByQuestion,
  userId: string | null
): SocialRhythmResult {
  const numeric_scores: QuizNumericScores = {
    Q1: scoreAnswer(answers.Q1),
    Q2: scoreAnswer(answers.Q2),
    Q3: scoreAnswer(answers.Q3),
    Q4: scoreAnswer(answers.Q4),
    Q5: scoreAnswer(answers.Q5),
    Q6: scoreAnswer(answers.Q6),
    Q7: scoreAnswer(answers.Q7),
    Q8: scoreAnswer(answers.Q8),
  };

  const dimensions: QuizDimensions = {
    stim: roundInt((numeric_scores.Q1 + numeric_scores.Q4) / 2),
    group_size: roundInt(numeric_scores.Q2),
    endurance: roundInt((numeric_scores.Q3 + numeric_scores.Q8) / 2),
    structure: roundInt(numeric_scores.Q5),
    connection: roundInt((numeric_scores.Q6 + numeric_scores.Q7) / 2),
  };

  const labels: QuizDimensionLabels = {
    stim: stimLabel(dimensions.stim),
    group_size: groupLabel(dimensions.group_size),
    endurance: enduranceLabel(dimensions.endurance),
    structure: structureLabel(dimensions.structure),
    connection: connectionLabel(dimensions.connection),
  };

  const summary = {
    group_size: labels.group_size,
    energy: labels.stim,
    meetup_length: labels.endurance,
    planning: labels.structure,
    conversation: labels.connection,
  };

  const style = deriveStyle(labels);
  const timestamp = new Date().toISOString();

  return {
    user_id: userId,
    timestamp,
    raw_answers: answers,
    numeric_scores,
    dimensions,
    labels,
    summary,
    style,
    label: style,
    quiz_version: "social_rhythm_v1",
  };
}
