export const questionsSample = {
  title: "Project setup",
  questions: [
    {
      id: "target",
      header: "Deploy target",
      question: "Where should the application run?",
      options: [
        {
          label: "Staging",
          description: "Preview changes before publishing.",
          recommended: true,
        },
        {
          label: "Production",
          description: "Make the application available to everyone.",
        },
      ],
    },
    {
      id: "checks",
      header: "Verification",
      question: "Which checks should run?",
      multi: true,
      options: [
        { label: "Unit tests", description: "Check individual modules." },
        {
          label: "Browser tests",
          description: "Verify the complete user experience.",
        },
      ],
    },
    { id: "notes", header: "Notes", question: "Any additional instructions?" },
  ],
};
export const questionsReply = (messages: any[]) => {
  const result = messages.filter((m) => m.role === "tool").at(-1)?.content;
  if (!result) return;
  const data = JSON.parse(result);
  return (
    "Questionnaire received\n" +
    (data.answers ?? [])
      .map(
        (a: any) =>
          `${a.id}:\n${[...a.selected, ...(a.text ? [a.text] : [])].join("\n")}`,
      )
      .join("\n")
  );
};
