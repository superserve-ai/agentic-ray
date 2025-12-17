"""Initialize new projects with templates."""

import shutil
import subprocess
import sys
from importlib import resources
from pathlib import Path

import click

from rayai.cli.analytics import track


@click.command()
@click.argument("project_name")
@click.option(
    "--type",
    "project_type",
    default="agent",
    type=click.Choice(["agent"]),
    help="Type of project to initialize (default: agent)",
)
def init(project_name: str, project_type: str):
    """Initialize a new project with the specified template."""

    target_dir = Path.cwd() / project_name

    try:
        import rayai.cli.templates

        templates_path = resources.files(rayai.cli.templates)
        available_templates = [
            item.name
            for item in templates_path.iterdir()
            if item.name != "__pycache__" and not item.name.endswith(".py")
        ]

        with resources.as_file(templates_path / project_type) as template_dir:
            if not template_dir.exists():
                click.echo(f"Error: Template '{project_type}' not found")
                click.echo(f"Available templates: {available_templates}")
                return

            if target_dir.exists():
                click.echo(f"Error: Directory '{project_name}' already exists")
                return

            try:
                shutil.copytree(template_dir, target_dir)

                pyproject_file = target_dir / "pyproject.toml"
                if pyproject_file.exists():
                    content = pyproject_file.read_text()
                    content = content.replace("{{PROJECT_NAME}}", project_name)
                    pyproject_file.write_text(content)

                readme_file = target_dir / "README.md"
                if readme_file.exists():
                    content = readme_file.read_text()
                    content = content.replace("{{PROJECT_NAME}}", project_name)
                    readme_file.write_text(content)

                click.echo(f"Created new {project_type} project: {project_name}")
                click.echo(f"Project location: {target_dir}")

                track("cli_init", {"project_type": project_type})

                if pyproject_file.exists():
                    click.echo("\nInstalling project in editable mode...")
                    try:
                        subprocess.run(
                            [
                                sys.executable,
                                "-m",
                                "pip",
                                "install",
                                "-e",
                                str(target_dir),
                            ],
                            check=True,
                            capture_output=True,
                            text=True,
                        )
                        click.echo("Project installed successfully")
                    except subprocess.CalledProcessError as e:
                        click.echo(f"Warning: Failed to install project: {e.stderr}")
                        click.echo(
                            f"You can install manually with: pip install -e {project_name}/"
                        )

                click.echo("\nNext steps:")
                click.echo(f"  cd {project_name}")
                click.echo("  # Edit .env file with your API keys")
                click.echo(
                    "  # Create your first agent: rayai create-agent <name> --framework <agent_framework>"
                )
                click.echo("  # Run agents: rayai serve")

            except Exception as e:
                click.echo(f"Error: Failed to create project: {e}")
                if target_dir.exists():
                    shutil.rmtree(target_dir)
    except ImportError:
        click.echo(f"Error: Could not find templates for '{project_type}'")
        return
