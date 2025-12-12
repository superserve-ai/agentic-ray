# Contributing to Agentic-Ray

Thank you for your interest in contributing to Agentic-Ray! We welcome contributions from the community.

## How to Contribute

1. **Fork the repository** on GitHub
2. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** and commit them with clear, descriptive messages
4. **Push to your fork** and submit a Pull Request

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/agentic-ray.git
cd agentic-ray

# Create a virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install in development mode with dev dependencies
pip install -e ".[dev]"

# Install pre-commit hooks
pre-commit install
```

## Code Style

We use automated tools to maintain consistent code style:

- **Ruff** for linting
- **Black** for code formatting

Run these before committing:

```bash
# Check for linting issues
ruff check .

# Format code
black .
```

Pre-commit hooks will run these automatically on each commit.

## Running Tests

```bash
pytest
```

## Pull Request Guidelines

- Provide a clear description of your changes
- Include tests for new features
- Ensure all tests pass
- Keep PRs focused on a single change

## Questions?

Feel free to open an issue if you have questions or need help getting started.
