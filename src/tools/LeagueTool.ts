import { config, getLeagueConfig } from "../config.js";
import type { SleeperLeague, SleeperUser } from "../types/sleeper.js";

export class LeagueTool {
  name = "get_league_info";
  description = "Get league information and settings";
  inputSchema = {
    type: "object",
    properties: {
      league: {
        type: "string",
        description: "League name (ROAD_TO_GLORY or DYNASTY), defaults to configured default",
        enum: ["ROAD_TO_GLORY", "DYNASTY"]
      }
    }
  };

  async execute(args: any) {
    const leagueConfig = getLeagueConfig(args.league);
    
    if (!leagueConfig) {
      throw new Error(`League configuration not found for: ${args.league}`);
    }

    try {
      const [leagueResponse, usersResponse] = await Promise.all([
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}`),
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/users`)
      ]);

      if (!leagueResponse.ok || !usersResponse.ok) {
        throw new Error('Failed to fetch league data');
      }

      const league: SleeperLeague = await leagueResponse.json();
      const users: SleeperUser[] = await usersResponse.json();

      const result = {
        league: {
          name: league.name,
          season: league.season,
          sport: league.sport,
          status: league.status,
          totalRosters: league.total_rosters,
          playoffWeekStart: league.settings.playoff_week_start,
          playoffTeams: league.settings.playoff_teams,
          waiverBudget: league.settings.waiver_budget
        },
        users: users.map(user => ({
          userId: user.user_id,
          username: user.username,
          displayName: user.display_name
        })),
        yourTeam: leagueConfig.teamName,
        leagueId: leagueConfig.id
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
      throw new Error(`Failed to get league info: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}