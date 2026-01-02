# Weather Agent Example

A weather assistant using Pydantic AI with batch_tool for parallel city lookups.

## Setup

1. Copy `.env.example` to `.env` and add your API keys:
   ```bash
   cp .env.example .env
   ```

2. Required API keys:
   - `OPENAI_API_KEY` - [OpenAI](https://platform.openai.com/)
   - `WEATHER_API_KEY` - [WeatherAPI](https://www.weatherapi.com/)

## Run

1. Install the package:
   ```bash
   pip install rayai
   ```

2. Navigate to the example:
   ```bash
   cd examples/weather_agent
   ```

3. Start the agent:
   ```bash
   rayai up
   ```

## Test

```bash
curl -X POST http://localhost:8000/weather/ \
  -H 'Content-Type: application/json' \
  -d '{"query": "What is the weather in New York, London, and Tokyo?"}'
```

## Tools

- `batch_weather` - Fetch weather for multiple cities in parallel via Ray
