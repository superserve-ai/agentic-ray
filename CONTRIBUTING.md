# Contributing to Superserve

Thank you for your interest in contributing to Superserve! We welcome contributions from the community.

## Getting Started

### Prerequisites

- Python 3.12+
- [uv](https://github.com/astral-sh/uv) for dependency management

### Development Setup

1. Fork the repository on GitHub.

2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/superserve.git
   cd superserve
   ```

3. Create a new branch for your changes:
   ```bash
   git checkout -b my-feature-branch
   ```

4. Install dependencies:
   ```bash
   uv sync --dev
   ```

5. Set up pre-commit hooks:
   ```bash
   uv run pre-commit install
   ```

6. Run tests to verify setup:
   ```bash
   uv run pytest
   ```

## How to Contribute

### Reporting Bugs

- Check existing [issues](https://github.com/superserve-ai/superserve/issues) to avoid duplicates
- Use a clear, descriptive title
- Include steps to reproduce the issue
- Provide relevant environment details (OS, Python version, etc.)

### Suggesting Features

- Open an issue with the `enhancement` label
- Describe the use case and expected behavior
- Explain why this would be useful to other users

### Pull Requests

1. Create a branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes and write tests if applicable

3. Ensure all tests pass:
   ```bash
   uv run pytest
   ```

4. Run linting and formatting:
   ```bash
   uv run ruff check . --fix
   uv run ruff format .
   ```

5. Run type checking:
   ```bash
   uv run mypy src/superserve
   ```

6. Commit with a clear message:
   ```bash
   git commit -m "feat: add your feature description"
   ```

7. Push and open a Pull Request

### Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `test:` - Adding or updating tests
- `refactor:` - Code changes that neither fix bugs nor add features
- `chore:` - Maintenance tasks

## Code Style

- We use [Ruff](https://github.com/astral-sh/ruff) for linting and formatting
- We use [mypy](https://mypy-lang.org/) for static type checking (enforced in CI)
- Type hints are encouraged

## Questions?

Feel free to open an issue for any questions or reach out to the maintainers.

## License

By contributing, you agree that your contributions will be licensed under the Open Core Ventures Source Available License (OCVSAL) 1.0.
