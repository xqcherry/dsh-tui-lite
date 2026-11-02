# Contributing

**English** | [简体中文](CONTRIBUTING.zh-CN.md)

Bug reports, suggestions, and pull requests are welcome. This project focuses on a simple, lightweight dsh TUI layer, so contributions should center on terminal input, presentation, and interaction, reuse existing Harness capabilities where possible, keep commands consolidated, and stay consistent with the existing internal style.

This guide references [pi's contributing guide](https://github.com/badlogic/pi-mono/blob/main/CONTRIBUTING.md). There are only two core requirements.

## 1. Submit issues with the templates

Search existing issues before submitting to avoid duplicates, then choose the matching template:

- [Bug report](.github/ISSUE_TEMPLATE/bug_report.md): describe the actual behavior, the expected behavior, minimal reproduction steps, and the runtime environment.
- [Feature request](.github/ISSUE_TEMPLATE/feature_request.md): describe the real use case, the inconvenience you hit, and how the change would help.

Keep it short and specific, and provide information you have verified yourself. Redact sensitive data such as API keys from logs and screenshots. If you are willing to implement the change, say so as well.

## 2. Own your code and treat production with care

**AI-generated or AI-assisted code is allowed, provided you understand your changes and take responsibility for the result.**

Before submitting, make sure you can explain the purpose of every change, how it is implemented, and how it relates to the existing system. Review the diff yourself, confirm the impact, and complete the necessary verification; if something breaks, you should be able to locate and fix it.

Submissions that are not understood, not reviewed, not verified, or carelessly AI-generated are not welcome. AI-generated explanations and "tests pass" conclusions do not replace your understanding of the code and actual verification.

In a pull request, state clearly:

- What problem the change solves and why it is needed.
- The main changes and their impact; link the related issue when one exists.
- The verification you actually ran and its results, plus anything still unresolved.

Read the [repository development rules](AGENTS.md) before starting. Modify `src/`, do not hand-edit the generated `lib/` directory, and keep each change focused on a single purpose.

Run the following before submitting code changes:

```sh
pnpm build
pnpm verify
```

Also complete the focused checks relevant to your change; terminal UI changes additionally require verification in a narrow TTY. Documentation-only changes only need a diff and link check.
