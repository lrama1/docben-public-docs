"""Generates narration for the API integration demos with edge-tts."""
import asyncio
import os
import edge_tts

VOICE = "en-US-JennyNeural"
BASE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "videos", "narration"))

# Video 1: Browser test client walkthrough (positioned as a SANDBOX, not the integration method)
CLIENT = {
    "intro": "This video shows the browser test client — a quick way to verify your DocBen PhilHealth Claims API key and explore the API before you write any code.",
    "connect": "Start by entering your API key. DocBen issues one key per tenant, shown only once. It is sent on every request as the x-api-key header.",
    "quota": "First, check your quota. The quota endpoint returns your monthly request quota, your token cap, your rate limit, and when they reset — a fast way to confirm your key works.",
    "sandbox": "A quick note: this test client is just a sandbox for exploring the API. It is not how you integrate. For real programmatic integration, follow the integration guide and use the client examples.",
    "submit": "Still, it is the easiest way to see a real request. You can submit a claim in two formats: the DocBen JSON format, or the official PhilHealth eClaims 3.0 XML.",
    "submitxml": "For this demo we will submit the official eClaims 3.0 XML format. Switch to the XML tab, review the document, and click Submit. The API translates the XML and validates it just like a JSON claim.",
    "poll": "Validation is asynchronous. The API returns a session ID, and you poll the status endpoint until it completes, usually within a minute.",
    "result": "When validation completes, the result includes a quality percentage, a list of rejection reasons, and the PhilHealth DRG classification.",
    "outro": "That was the test client. To integrate this into your own system, read the integration guide and drop in the ready-made JavaScript or TypeScript client from the examples folder.",
}

# Video 2: curl walkthrough
CURL = {
    "intro": "This video shows the raw HTTP requests for integrating with the DocBen PhilHealth Claims API, using curl.",
    "auth": "Every request must include your API key in the x-api-key header. Replace YOUR_API_KEY with the key DocBen issued to you.",
    "quota": "Start with a GET to the quota endpoint to confirm your key works and see your limits.",
    "submit": "To validate a claim, POST it to the validations endpoint as JSON. The API responds with a session ID and a status of processing.",
    "poll": "Then poll the validation status endpoint with that session ID until the status becomes completed.",
    "result": "The completed response contains the quality percentage, any rejection reasons, and the DRG classification.",
    "outro": "You can copy ready-made JavaScript and TypeScript clients from the examples folder, or import the OpenAPI spec into Postman. See the integration guide for details.",
}

async def gen(lines, prefix):
    os.makedirs(BASE, exist_ok=True)
    for key, text in lines.items():
        out = os.path.join(BASE, f"{prefix}-{key}.mp3")
        await edge_tts.Communicate(text, VOICE).save(out)
        print("wrote", out)

async def main():
    await gen(CLIENT, "apiclient")
    await gen(CURL, "curl")

asyncio.run(main())
