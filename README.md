# Rajasthan Royals Pressure Selector

A responsive Rajasthan Royals-inspired dashboard with a read-only Node.js API and reproducible player rankings. The navy, pink, and gold palette is an independent fan design; it does not use official team marks.

## Run locally

Requires Node.js 20 or newer. From the repository root, run `npm start` and open `http://localhost:10000`. The server uses `PORT` when provided and binds to `0.0.0.0` for Render.

## API

- `GET /healthz` - health check
- `GET /api/summary` - dataset and eligibility counts
- `GET /api/rankings?type=batters&limit=10` - ranked batters; use `bowlers` for bowlers and `all` for the full list
- `GET /api/rankings?type=batters&search=Haris` - name search
- `GET /api/players/8741?type=batters` - one player record

The backend serves packaged leaderboards as read-only JSON. When served over HTTP, the dashboard loads rankings through the API. The standalone `pressure_performance_dashboard.html` also contains an embedded copy for offline viewing.

## Deploy on Render

The root `render.yaml` defines the Node web service, build/start commands, and `/healthz` health check. Connect this repository in Render and create a Blueprint from `render.yaml`.

The app uses Render's `PORT` and binds to `0.0.0.0`. See [Render web services](https://render.com/docs/web-services) and the [Blueprint YAML reference](https://render.com/docs/blueprint-spec).

## Update the rankings

Install Python 3.10+, NumPy, and pandas, then run:

```powershell
python pressure_model.py --data-pack "path/to/data_pack.zip" --output-dir outputs
python dashboard_builder.py
```

Commit the generated `index.html` and `data/` updates to trigger a new Render deploy.
