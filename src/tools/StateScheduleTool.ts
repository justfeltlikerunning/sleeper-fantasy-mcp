import { config } from "../config.js";

export class StateScheduleTool {
  name = "get_nfl_state";
  description = "Get current NFL season state including week, playoffs, and team bye weeks";
  inputSchema = {
    type: "object",
    properties: {
      includeByeWeeks: {
        type: "boolean",
        description: "Include team bye weeks information (default: true)",
        default: true
      },
      season: {
        type: "string",
        description: "Season year (defaults to current season)",
        pattern: "^[0-9]{4}$"
      }
    }
  };

  async execute(args: any) {
    const includeByeWeeks = args.includeByeWeeks !== false; // Default to true
    const season = args.season || new Date().getFullYear().toString();

    try {
      // Fetch NFL state
      const stateResponse = await fetch(`${config.api.baseUrl}/state/nfl`);
      if (!stateResponse.ok) {
        throw new Error('Failed to fetch NFL state');
      }
      
      const nflState = await stateResponse.json();

      // Parse the NFL state data
      const result: any = {
        season: season,
        currentWeek: nflState.week,
        seasonType: nflState.season_type, // 'regular', 'post', 'pre', 'off'
        status: {
          isRegularSeason: nflState.season_type === 'regular',
          isPostseason: nflState.season_type === 'post',
          isPreseason: nflState.season_type === 'pre',
          isOffseason: nflState.season_type === 'off'
        },
        schedule: {
          regularSeasonWeeks: 18,
          playoffWeekStart: 19,
          currentSeasonWeek: nflState.week,
          weeksRemaining: nflState.season_type === 'regular' ? Math.max(0, 18 - nflState.week) : 0
        },
        timestamps: {
          seasonStart: this.getSeasonStartDate(season),
          currentWeekStart: this.getWeekStartDate(nflState.week, season),
          nextWeekStart: this.getWeekStartDate(nflState.week + 1, season)
        }
      };

      // Add bye weeks information if requested
      if (includeByeWeeks) {
        const byeWeeks = this.getByeWeekSchedule(season);
        const currentByeTeams = byeWeeks[nflState.week] || [];
        const upcomingByes = this.getUpcomingByes(byeWeeks, nflState.week);

        result.byeWeeks = {
          currentWeek: {
            week: nflState.week,
            teamsOnBye: currentByeTeams,
            teamCount: currentByeTeams.length
          },
          upcoming: upcomingByes,
          fullSchedule: byeWeeks,
          summary: {
            totalByeWeeks: Object.keys(byeWeeks).length,
            weeksWithByes: Object.keys(byeWeeks).map(Number).sort((a, b) => a - b),
            remainingByeWeeks: Object.keys(byeWeeks)
              .map(Number)
              .filter(week => week > nflState.week)
              .sort((a, b) => a - b)
          }
        };
      }

      // Add contextual information
      result.context = {
        isFantasyRelevant: nflState.season_type === 'regular' || nflState.season_type === 'post',
        weekDescription: this.getWeekDescription(nflState.week, nflState.season_type),
        nextWeekPreview: this.getNextWeekPreview(nflState.week, nflState.season_type, includeByeWeeks ? this.getByeWeekSchedule(season) : {}),
        fantasyImplications: this.getFantasyImplications(nflState.week, nflState.season_type)
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new Error(`Failed to get NFL state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getSeasonStartDate(season: string): string {
    // NFL season typically starts first Thursday of September
    const year = parseInt(season);
    const septemberFirst = new Date(year, 8, 1); // September = month 8 (0-indexed)
    const dayOfWeek = septemberFirst.getDay();
    const firstThursday = 1 + (4 - dayOfWeek + 7) % 7; // Find first Thursday
    return new Date(year, 8, firstThursday).toISOString();
  }

  private getWeekStartDate(week: number, season: string): string {
    const seasonStart = new Date(this.getSeasonStartDate(season));
    const weekStart = new Date(seasonStart);
    weekStart.setDate(seasonStart.getDate() + (week - 1) * 7);
    return weekStart.toISOString();
  }

  private getByeWeekSchedule(season: string): Record<number, string[]> {
    // 2024/2025 NFL bye week schedule (weeks 5-14 typically)
    // This would ideally come from an API, but hardcoded for now
    const byeSchedule2024: Record<number, string[]> = {
      5: ['GB', 'LV'],
      6: ['LAR', 'MIA', 'MIN', 'PHI'],
      7: ['BUF', 'NO', 'NYJ', 'TEN'],
      8: ['SF'],
      9: ['ATL', 'CAR', 'CHI', 'DAL', 'DEN', 'HOU', 'NE', 'NYG', 'WAS'],
      10: ['ARI', 'BAL', 'CLE', 'LAC', 'PIT', 'SEA'],
      11: ['CIN', 'DET', 'IND', 'JAX', 'KC', 'TB'],
      12: [],
      13: [],
      14: []
    };

    // For other seasons, we'd need to fetch from an API or database
    // For now, return the 2024 schedule
    return byeSchedule2024;
  }

  private getUpcomingByes(byeWeeks: Record<number, string[]>, currentWeek: number): Array<{week: number, teams: string[]}> {
    return Object.entries(byeWeeks)
      .map(([week, teams]) => ({ week: parseInt(week), teams }))
      .filter(bye => bye.week > currentWeek && bye.teams.length > 0)
      .sort((a, b) => a.week - b.week)
      .slice(0, 3); // Next 3 weeks with byes
  }

  private getWeekDescription(week: number, seasonType: string): string {
    if (seasonType !== 'regular') {
      return `${seasonType} season`;
    }

    if (week <= 3) return `Early season (Week ${week})`;
    if (week <= 6) return `Early season with bye weeks (Week ${week})`;
    if (week <= 12) return `Mid-season (Week ${week})`;
    if (week <= 15) return `Late season (Week ${week})`;
    if (week <= 18) return `Final regular season weeks (Week ${week})`;
    return `Post-season (Week ${week})`;
  }

  private getNextWeekPreview(week: number, seasonType: string, byeWeeks: Record<number, string[]>): string {
    if (seasonType !== 'regular') {
      return 'Check playoff schedule for next matchups';
    }

    const nextWeek = week + 1;
    if (nextWeek > 18) {
      return 'Regular season complete - playoffs begin';
    }

    const nextWeekByes = byeWeeks[nextWeek] || [];
    if (nextWeekByes.length > 0) {
      return `Week ${nextWeek}: ${nextWeekByes.length} teams on bye (${nextWeekByes.join(', ')})`;
    }

    return `Week ${nextWeek}: No teams on bye`;
  }

  private getFantasyImplications(week: number, seasonType: string): string[] {
    const implications: string[] = [];

    if (seasonType === 'regular') {
      if (week <= 3) {
        implications.push('Early season - small sample sizes, watch for breakout players');
        implications.push('Monitor snap counts and target shares for trending players');
      } else if (week <= 6) {
        implications.push('Bye weeks begin - plan for roster depth');
        implications.push('Waiver wire becomes more competitive');
      } else if (week <= 12) {
        implications.push('Trade deadline approaches - evaluate buy/sell opportunities');
        implications.push('Injury concerns mount - handcuffs become valuable');
      } else if (week <= 15) {
        implications.push('Fantasy playoffs approaching - prioritize ceiling over floor');
        implications.push('Weather becomes factor for outdoor games');
      } else {
        implications.push('Fantasy championship weeks - start your best players');
        implications.push('Some teams may rest starters if playoff position secured');
      }
    } else if (seasonType === 'post') {
      implications.push('Fantasy playoffs typically complete');
      implications.push('Some leagues extend into NFL playoffs');
    } else {
      implications.push('Offseason - focus on dynasty leagues and draft preparation');
    }

    return implications;
  }
}