# Grappenscore

Luisteraars geven met hun telefoon een 👍 **goed** of 👎 **slecht** op de grap die de presentator op dat moment vertelt.

- **`/`**: de luisterpagina. Toont alleen het nummer van de actieve grap en twee knoppen.
- **`/regie`**: de presentatorpagina, achter een pincode. Hier voeg je grappen toe, met een nummer, een titel en een omschrijving die alleen jij ziet. Je activeert de grap die je gaat vertellen, ziet de stemmen live binnenkomen, sluit of heropent het stemmen en bekijkt de ranglijst.

## Sessies

- In `/regie` start je eerst een **sessie** met een naam (bijv. "Open podium Utrecht"). De datum wordt automatisch opgeslagen.
- Stemmen kan alleen als er een sessie loopt. Elke stem wordt bewaard bij de sessie, dus elke avond heeft een eigen uitslag.
- Met **Sessie beëindigen** stop je de sessie. De scores blijven bewaard en staan onder **Sessies**, met per sessie de ranglijst, een knop **Download JSON** en een knop **Verwijderen**.
- Via de API: `GET /api/sessions` (alle sessies met uitslag) en `GET /api/sessions/:id`, allebei met de header `x-pin`.

## Synchronisatie

- Er is altijd hooguit één grap actief. Als de presentator op **Activeer** of **Volgende →** tikt, springt elke telefoon direct naar het nieuwe nummer. De telefoon trilt daarbij kort.
- De server neemt een stem alleen aan als die bij de grap hoort die op dat moment actief is, en als het stemmen open staat. Een late tik op een vorige grap telt dus niet mee.
- Elke telefoon krijgt een eigen ID, dus iedereen heeft één stem per grap. Een luisteraar mag van keuze wisselen zolang het stemmen open is.
- Grappen en stemmen worden bewaard in `data.json` en blijven bewaard als de server herstart.

## Lokaal draaien

```bash
npm install
PIN=4821 npm start          # standaard-PIN is 1234, poort 3000
```

Telefoons die op hetzelfde wifi-netwerk zitten, kunnen dan naar `http://<ip-van-je-laptop>:3000`.

## Online zetten (bereikbaar via mobiel internet)

Je kunt de app op elke Node-host draaien, zoals Render, Railway, Fly.io of een eigen VPS:

- **Start-commando:** `npm start`
- **Omgevingsvariabelen:** `PIN` (verplicht wijzigen) en optioneel `PORT` en `DATA_FILE`
- De host moet WebSockets ondersteunen. Dat doen de genoemde hosts standaard.
- Wil je de stemmen bewaren na een nieuwe deploy? Laat `DATA_FILE` dan naar een persistent volume wijzen, bijvoorbeeld `/data/data.json`.

### Fly.io (aanbevolen)

`fly.toml` staat klaar: regio Amsterdam, één machine die altijd aan staat, een volume op `/data` en een health check op `/health`.

```bash
brew install flyctl
fly auth login
fly apps create grappenscore              # of een andere naam, pas dan 'app' in fly.toml aan
fly volumes create grappen_data --region ams --size 1
fly secrets set PIN=<eigen-pincode>
fly deploy --ha=false                     # precies één machine (de stand staat in het geheugen)
```

Daarna draait de app op `https://grappenscore.fly.dev`. Met `fly logs` bekijk je de logs.

### Docker

Met Docker gaat het zo:

```bash
docker build -t grappenscore .
docker run -p 3000:3000 -e PIN=4821 -v grappen-data:/data grappenscore
```
