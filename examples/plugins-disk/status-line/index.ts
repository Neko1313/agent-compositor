export const hooks = {
  "ui.render": (e: { site: string; props: { model?: string; turns?: number } }) => ({
    tree: {
      rows: [[` ${e.site} `, ` model: ${e.props.model ?? "?"}`, ` turns: ${e.props.turns ?? 0}`, " [q]uit "]],
    },
  }),
};
