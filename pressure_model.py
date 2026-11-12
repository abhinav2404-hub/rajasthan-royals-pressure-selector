#!/usr/bin/env python3
"""Reproducible pressure-performance rankings for SupeRR Selector S2."""
from __future__ import annotations
import argparse
import io
import zipfile
from pathlib import Path
import numpy as np
import pandas as pd

FILES = {
    "balls": "Data Pack/ball_by_ball.csv",
    "matches": "Data Pack/matches.csv",
    "competitions": "Data Pack/competitions.csv",
}


def read_pack(path: Path):
    with zipfile.ZipFile(path) as z:
        return {k: pd.read_csv(z.open(name), low_memory=False) for k, name in FILES.items()}


def build_delivery_table(pack):
    b, m, c = pack["balls"], pack["matches"], pack["competitions"]
    mcols = ["match_id", "comp_id", "match_date", "first_inn_revised_overs", "second_inn_revised_overs", "revised_target"]
    b = b.merge(m[mcols], on="match_id", how="inner", validate="many_to_one")
    b = b.merge(c[["comp_id", "match_format"]], on="comp_id", how="left", validate="many_to_one")
    # Standard T20 innings only; super overs (innings 3+) are excluded.
    b = b[b.innings.isin([1, 2])].copy()
    b = b.sort_values(["match_id", "innings", "innings_ball_num", "overid", "over_ball_num"], kind="stable").reset_index(drop=True)
    b["extras_type"] = b.extras_type.fillna("").str.strip().str.lower()
    b["legal"] = ~b.extras_type.isin(["wide", "overstep"])
    b["faced"] = b.extras_type.ne("wide")
    b["team_runs"] = b.runs.fillna(0) + b.extras1_runs.fillna(0) + b.extras_2_runs.fillna(0)
    b["wicket"] = b.is_wicket.astype(str).str.lower().eq("true")
    b["dismissed_id_num"] = pd.to_numeric(b.dismissed_player_id, errors="coerce")
    b["striker_id_num"] = pd.to_numeric(b.striker_id, errors="coerce")
    b["batter_out"] = b.wicket & b.dismissed_id_num.eq(b.striker_id_num)
    non_bowler_dismissals = {"runout", "retire out", "retired hurt", "obstracting the field", "obstructing the field"}
    b["bowler_wicket"] = b.wicket & ~b.dismissal_type.fillna("").str.lower().isin(non_bowler_dismissals)
    # Byes and leg-byes are not charged to the bowler; wides and no-ball penalties are.
    non_bowler_extras = b.extras_type.isin(["byes", "legbyes", "penalty"])
    b["bowler_runs"] = b.team_runs - (b.extras1_runs.fillna(0) + b.extras_2_runs.fillna(0)).where(non_bowler_extras, 0)
    keys = ["match_id", "innings"]
    # Label the state immediately before each delivery so the delivery outcome
    # cannot influence whether that same delivery counts as pressure.
    grouped = b.groupby(keys, sort=False)
    b["legal_before"] = grouped.legal.cumsum().groupby([b.match_id, b.innings], sort=False).shift(1).fillna(0)
    b["wickets_before"] = grouped.wicket.cumsum().groupby([b.match_id, b.innings], sort=False).shift(1).fillna(0)
    b["runs_before"] = grouped.team_runs.cumsum().groupby([b.match_id, b.innings], sort=False).shift(1).fillna(0)
    first_total = b[b.innings.eq(1)].groupby("match_id").team_runs.sum().add(1).rename("target")
    b = b.join(first_total, on="match_id")
    b["innings_balls"] = np.where(b.innings.eq(1), b.first_inn_revised_overs, b.second_inn_revised_overs)
    b["innings_balls"] = pd.to_numeric(b.innings_balls, errors="coerce").fillna(120).clip(upper=120)
    # revised_overs stores the revised legal-ball allocation in this data pack.
    b["balls_left"] = (b.innings_balls - b.legal_before).clip(lower=0)
    b["wickets_left"] = (10 - b.wickets_before).clip(lower=0)
    revised_target = pd.to_numeric(b.revised_target, errors="coerce")
    b["target"] = np.where(b.innings.eq(2) & revised_target.notna(), revised_target, b.target)
    b["runs_needed"] = b.target - b.runs_before
    b["rrr"] = b.runs_needed * 6 / b.balls_left.replace(0, np.nan)
    chase = b.innings.eq(2)
    death_phase = b.legal_before.ge((b.innings_balls - 30).clip(lower=0))
    chase_pressure = (b.rrr.ge(9.0) | (b.legal_before.ge(60) & b.wickets_left.le(5)) | death_phase)
    first_pressure = death_phase & b.wickets_left.le(5)
    b["pressure"] = np.where(chase, chase_pressure, first_pressure)
    return b


def rate_players(b, player_col, name_col, role):
    is_bat = role == "batter"
    base = b[b[player_col].notna() & (b.faced if is_bat else b.legal)].copy()
    base["player_id"] = pd.to_numeric(base[player_col], errors="coerce")
    base = base[base.player_id.notna()]
    base.player_id = base.player_id.astype("int64")
    records = []
    for pid, x in base.groupby("player_id", sort=False):
        p = x[x.pressure]
        o = x[~x.pressure]
        pn = int(p.faced.sum()) if is_bat else int(p.legal.sum())
        on = int(o.faced.sum()) if is_bat else int(o.legal.sum())
        min_pressure, min_ordinary = (60, 200) if is_bat else (60, 180)
        if pn < min_pressure or on < min_ordinary or p.match_id.nunique() < 8:
            continue
        if is_bat:
            pressure_rate = p.runs.sum() / pn * 100
            ordinary_rate = o.runs.sum() / on * 100
            pressure_out = p.batter_out.sum() / pn * 100
            ordinary_out = o.batter_out.sum() / on * 100
            raw = (pressure_rate - ordinary_rate) - 0.60 * (pressure_out - ordinary_out)
        else:
            pressure_rate = p.bowler_runs.sum() / pn * 6
            ordinary_rate = o.bowler_runs.sum() / on * 6
            pressure_out = p.bowler_wicket.sum() / pn * 100
            ordinary_out = o.bowler_wicket.sum() / on * 100
            raw = (ordinary_rate - pressure_rate) * (100 / 6) + 0.60 * (pressure_out - ordinary_out)
        score = raw * pn / (pn + 60)
        records.append({
            "player_id": int(pid), "player": x[name_col].dropna().iloc[0],
            "ordinary_balls": on, "pressure_balls": pn,
            "ordinary_rate": ordinary_rate, "pressure_rate": pressure_rate,
            "ordinary_wicket_rate": ordinary_out, "pressure_wicket_rate": pressure_out,
            "raw_advantage": raw, "adjusted_score": score,
            "matches": int(x.match_id.nunique()), "pressure_matches": int(p.match_id.nunique()),
        })
    result = pd.DataFrame(records).sort_values(["adjusted_score", "pressure_balls"], ascending=False).reset_index(drop=True)
    result.insert(0, "rank", range(1, len(result) + 1))
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-pack", required=True, type=Path, help="Path to the supplied data_pack.zip")
    ap.add_argument("--output-dir", type=Path, default=Path("outputs"))
    args = ap.parse_args()
    pack = read_pack(args.data_pack)
    b = build_delivery_table(pack)
    bat = rate_players(b, "striker_id", "striker_name", "batter")
    bowl = rate_players(b, "bowler_id", "bowler_name", "bowler")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, df in [("batter", bat), ("bowler", bowl)]:
        df.to_csv(args.output_dir / f"{name}_leaderboard.csv", index=False)
        top = df.head(10).copy()
        top.to_csv(args.output_dir / f"{name}_top10.csv", index=False)
    print(f"Matches: {b.match_id.nunique():,}; standard-innings deliveries: {len(b):,}; pressure deliveries: {int(b.pressure.sum()):,}")
    print(f"T20/T20I formats: {b.match_format.value_counts().to_dict()}")
    print("Rankings saved in", args.output_dir.resolve())

if __name__ == "__main__":
    main()
