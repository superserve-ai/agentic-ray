"""Tests for BatchTool."""

from rayai import BatchTool, BatchToolInput, BatchToolOutput
from rayai.decorators import tool


class TestBatchTool:
    """Tests for BatchTool."""

    def test_basic_batch_execution(self, ray_start):
        """Test basic parallel execution."""

        @tool(desc="Double a number")
        def double(x: int) -> int:
            return x * 2

        batch_tool = BatchTool(tools=[double])
        result = batch_tool(
            tool_name="double", tool_inputs=[{"x": 1}, {"x": 2}, {"x": 3}]
        )

        assert result["results"] == [2, 4, 6]
        assert result["errors"] == [None, None, None]
        assert result["count"] == 3
        assert result["tool_name"] == "double"

    def test_empty_inputs(self, ray_start):
        """Test handling empty inputs."""

        @tool(desc="Test")
        def test_tool(x: int) -> int:
            return x

        batch_tool = BatchTool(tools=[test_tool])
        result = batch_tool(tool_name="test_tool", tool_inputs=[])

        assert result["results"] == []
        assert result["errors"] == []
        assert result["count"] == 0

    def test_tool_not_found(self, ray_start):
        """Test error handling for unknown tool."""
        batch_tool = BatchTool(tools=[])
        result = batch_tool(tool_name="nonexistent", tool_inputs=[{"x": 1}])

        assert result["results"] == [None]
        assert "not found" in result["errors"][0]
        assert result["tool_name"] == "nonexistent"

    def test_partial_errors(self, ray_start):
        """Test handling of partial execution errors."""

        @tool(desc="May fail")
        def may_fail(x: int) -> int:
            if x < 0:
                raise ValueError("Negative not allowed")
            return x

        batch_tool = BatchTool(tools=[may_fail])
        result = batch_tool(
            tool_name="may_fail", tool_inputs=[{"x": 1}, {"x": -1}, {"x": 2}]
        )

        assert result["results"][0] == 1
        assert result["results"][1] is None
        assert result["results"][2] == 2
        assert result["errors"][0] is None
        assert "error" in result["errors"][1].lower()
        assert result["errors"][2] is None

    def test_multiple_tools(self, ray_start):
        """Test BatchTool with multiple registered tools."""

        @tool(desc="Add one")
        def add_one(x: int) -> int:
            return x + 1

        @tool(desc="Multiply by two")
        def multiply_two(x: int) -> int:
            return x * 2

        batch_tool = BatchTool(tools=[add_one, multiply_two])

        result1 = batch_tool("add_one", [{"x": 5}, {"x": 10}])
        assert result1["results"] == [6, 11]

        result2 = batch_tool("multiply_two", [{"x": 5}, {"x": 10}])
        assert result2["results"] == [10, 20]

    def test_multi_param_tool(self, ray_start):
        """Test tool with multiple parameters."""

        @tool(desc="Add two numbers")
        def add(a: int, b: int) -> int:
            return a + b

        batch_tool = BatchTool(tools=[add])
        result = batch_tool(
            "add", [{"a": 1, "b": 2}, {"a": 10, "b": 20}, {"a": 100, "b": 200}]
        )

        assert result["results"] == [3, 30, 300]
        assert result["errors"] == [None, None, None]

    def test_custom_name_and_description(self, ray_start):
        """Test custom name and description."""

        @tool(desc="Test")
        def test_tool(x: int) -> int:
            return x

        batch_tool = BatchTool(
            tools=[test_tool],
            name="custom_batch",
            description="My custom batch tool",
        )

        assert batch_tool.name == "custom_batch"
        assert batch_tool.description == "My custom batch tool"

    def test_tool_metadata(self, ray_start):
        """Test that BatchTool has proper metadata for framework detection."""

        @tool(desc="Test")
        def test_tool(x: int) -> int:
            return x

        batch_tool = BatchTool(tools=[test_tool])

        assert hasattr(batch_tool, "_tool_metadata")
        assert batch_tool._tool_metadata["is_batch_tool"] is True
        assert hasattr(batch_tool, "args_schema")
        assert batch_tool.args_schema == BatchToolInput


class TestBatchToolInputOutput:
    """Tests for Pydantic models."""

    def test_batch_tool_input_validation(self):
        """Test BatchToolInput Pydantic model."""
        inp = BatchToolInput(tool_name="test", tool_inputs=[{"a": 1}, {"a": 2}])
        assert inp.tool_name == "test"
        assert len(inp.tool_inputs) == 2

    def test_batch_tool_output_model(self):
        """Test BatchToolOutput Pydantic model."""
        out = BatchToolOutput(
            results=[1, 2, 3],
            errors=[None, "error", None],
            tool_name="test",
            count=3,
        )
        assert out.results == [1, 2, 3]
        assert out.errors == [None, "error", None]
        assert out.tool_name == "test"
        assert out.count == 3

    def test_model_dump(self):
        """Test model serialization."""
        out = BatchToolOutput(results=[1], errors=[None], tool_name="t", count=1)
        dumped = out.model_dump()

        assert isinstance(dumped, dict)
        assert dumped["results"] == [1]
        assert dumped["errors"] == [None]
        assert dumped["tool_name"] == "t"
        assert dumped["count"] == 1


class TestBatchToolConversion:
    """Tests for BatchTool framework conversion."""

    def test_to_raytool_conversion(self, ray_start):
        """Test conversion to RayTool."""
        from rayai.adapters.core import to_raytool

        @tool(desc="Test")
        def test_tool(x: int) -> int:
            return x

        batch_tool = BatchTool(tools=[test_tool])
        ray_tool = to_raytool(batch_tool)

        assert ray_tool.name == "batch"
        assert ray_tool.source_framework == "batch_tool"
        assert ray_tool.args_schema == BatchToolInput

    def test_detect_framework(self, ray_start):
        """Test framework detection for BatchTool."""
        from rayai.adapters.core import SourceFramework, detect_framework

        @tool(desc="Test")
        def test_tool(x: int) -> int:
            return x

        batch_tool = BatchTool(tools=[test_tool])
        detected = detect_framework(batch_tool)

        assert detected == SourceFramework.RAY_TOOL


class TestBatchToolWithPlainCallables:
    """Tests for BatchTool with plain callable functions."""

    def test_plain_callable(self, ray_start):
        """Test BatchTool with plain callable (not @tool decorated)."""

        def plain_func(x: int) -> int:
            return x * 3

        batch_tool = BatchTool(tools=[plain_func])
        result = batch_tool("plain_func", [{"x": 2}, {"x": 4}])

        assert result["results"] == [6, 12]
        assert result["errors"] == [None, None]

    def test_mixed_tools(self, ray_start):
        """Test BatchTool with both decorated and plain functions."""

        @tool(desc="Decorated")
        def decorated(x: int) -> int:
            return x + 1

        def plain(x: int) -> int:
            return x - 1

        batch_tool = BatchTool(tools=[decorated, plain])

        result1 = batch_tool("decorated", [{"x": 10}])
        assert result1["results"] == [11]

        result2 = batch_tool("plain", [{"x": 10}])
        assert result2["results"] == [9]
