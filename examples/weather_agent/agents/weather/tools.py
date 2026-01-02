"""Weather tools with batch_tool for parallel execution."""

import os

import requests

import rayai


@rayai.tool(num_cpus=1)
def get_weather(city: str) -> dict:
    """Fetch current weather for a single city from WeatherAPI.com.

    Args:
        city: Name of the city (e.g., "London", "New York", "Tokyo")

    Returns:
        Dict with weather data including temperature, humidity, and conditions.
    """
    api_key = os.environ.get("WEATHER_API_KEY")

    if not api_key:
        return {"city": city, "error": "WEATHER_API_KEY not set"}

    try:
        response = requests.get(
            "https://api.weatherapi.com/v1/current.json",
            params={"key": api_key, "q": city},
            timeout=10,
        )

        if response.status_code != 200:
            return {"city": city, "error": f"API error: {response.status_code}"}

        data = response.json()
        return {
            "city": data["location"]["name"],
            "temperature": data["current"]["temp_c"],
            "feels_like": data["current"]["feelslike_c"],
            "humidity": data["current"]["humidity"],
            "condition": data["current"]["condition"]["text"],
        }

    except requests.RequestException as e:
        return {"city": city, "error": str(e)}


batch_weather = rayai.batch_tool(tools=[get_weather], name="batch_weather")
