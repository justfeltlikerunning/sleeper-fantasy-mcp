import { config, getLeagueConfig } from "../config.js";
import type { SleeperRoster, SleeperUser } from "../types/sleeper.js";

export class RosterTool {
  name = "get_my_roster";
  description = "Get your team's roster with player details";
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
      const [rostersResponse, usersResponse, playersResponse] = await Promise.all([
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/rosters`),
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/users`),
        fetch(`${config.api.baseUrl}/players/nfl`)
      ]);

      if (!rostersResponse.ok || !usersResponse.ok || !playersResponse.ok) {
        throw new Error('Failed to fetch roster data');
      }

      const rosters: SleeperRoster[] = await rostersResponse.json();
      const users: SleeperUser[] = await usersResponse.json();
      const players = await playersResponse.json();

      const userMap = new Map(users.map(user => [user.user_id, user]));
      
      // Match by display_name first (which is "Richard1012"), then fallback to team names
      const myRoster = rosters.find(roster => {
        const user = userMap.get(roster.owner_id);
        return user?.display_name === config.username || 
               user?.username === config.username ||
               user?.display_name === leagueConfig.teamName || 
               user?.username === leagueConfig.teamName;
      });

      if (!myRoster) {
        throw new Error(`Could not find roster for user: ${config.username} or team: ${leagueConfig.teamName}`);
      }

      const getPlayerInfo = (playerId: string) => {
        const player = players[playerId];
        return player ? {
          name: `${player.first_name} ${player.last_name}`,
          position: player.position,
          team: player.team,
          status: player.status
        } : { name: 'Unknown Player', position: 'UNK', team: 'UNK', status: 'unknown' };
      };

      const result = {
        teamName: leagueConfig.teamName,
        rosterId: myRoster.roster_id,
        record: {
          wins: myRoster.settings.wins,
          losses: myRoster.settings.losses,
          ties: myRoster.settings.ties
        },
        points: {
          for: myRoster.settings.fpts,
          against: myRoster.settings.fpts_against
        },
        starters: myRoster.starters.map(playerId => ({
          playerId,
          ...getPlayerInfo(playerId)
        })),
        bench: myRoster.players.filter(p => !myRoster.starters.includes(p)).map(playerId => ({
          playerId,
          ...getPlayerInfo(playerId)
        })),
        totalPlayers: myRoster.players.length
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
      throw new Error(`Failed to get roster: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}