import { config, getLeagueConfig } from "../config.js";
import type { SleeperMatchup, SleeperRoster, SleeperUser } from "../types/sleeper.js";

export class MatchupTool {
  name = "get_my_matchup";
  description = "Get your current week matchup details";
  inputSchema = {
    type: "object",
    properties: {
      league: {
        type: "string",
        description: "League name (ROAD_TO_GLORY or DYNASTY), defaults to configured default",
        enum: ["ROAD_TO_GLORY", "DYNASTY"]
      },
      week: {
        type: "number",
        description: "Week number (defaults to current week)",
        minimum: 1,
        maximum: 18
      }
    }
  };

  async execute(args: any) {
    const leagueConfig = getLeagueConfig(args.league);
    
    if (!leagueConfig) {
      throw new Error(`League configuration not found for: ${args.league}`);
    }

    const week = args.week || this.getCurrentWeek();

    try {
      const [matchupsResponse, rostersResponse, usersResponse, playersResponse] = await Promise.all([
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/matchups/${week}`),
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/rosters`),
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/users`),
        fetch(`${config.api.baseUrl}/players/nfl`)
      ]);

      if (!matchupsResponse.ok || !rostersResponse.ok || !usersResponse.ok || !playersResponse.ok) {
        throw new Error('Failed to fetch matchup data');
      }

      const matchups: SleeperMatchup[] = await matchupsResponse.json();
      const rosters: SleeperRoster[] = await rostersResponse.json();
      const users: SleeperUser[] = await usersResponse.json();
      const players = await playersResponse.json();

      const userMap = new Map(users.map(user => [user.user_id, user]));
      const rosterMap = new Map(rosters.map(roster => [roster.roster_id, roster]));
      
      const myRoster = rosters.find(roster => {
        const user = userMap.get(roster.owner_id);
        return user?.display_name === config.username || 
               user?.username === config.username ||
               user?.display_name === leagueConfig.teamName || 
               user?.username === leagueConfig.teamName;
      });

      if (!myRoster) {
        throw new Error(`Could not find roster for team: ${leagueConfig.teamName}`);
      }

      const myMatchup = matchups.find(m => m.roster_id === myRoster.roster_id);
      if (!myMatchup) {
        throw new Error(`No matchup found for week ${week}`);
      }

      const opponentMatchup = matchups.find(m => 
        m.matchup_id === myMatchup.matchup_id && m.roster_id !== myRoster.roster_id
      );

      const getPlayerInfo = (playerId: string) => {
        const player = players[playerId];
        return player ? {
          name: `${player.first_name} ${player.last_name}`,
          position: player.position,
          team: player.team
        } : { name: 'Unknown Player', position: 'UNK', team: 'UNK' };
      };

      const getTeamName = (rosterId: number) => {
        const roster = rosterMap.get(rosterId);
        if (roster) {
          const user = userMap.get(roster.owner_id);
          return user?.display_name || user?.username || 'Unknown Team';
        }
        return 'Unknown Team';
      };

      const result = {
        week,
        myTeam: {
          name: leagueConfig.teamName,
          rosterId: myMatchup.roster_id,
          points: myMatchup.points,
          starters: myMatchup.starters.map((playerId, index) => ({
            playerId,
            points: myMatchup.starters_points[index],
            ...getPlayerInfo(playerId)
          }))
        },
        opponent: opponentMatchup ? {
          name: getTeamName(opponentMatchup.roster_id),
          rosterId: opponentMatchup.roster_id,
          points: opponentMatchup.points,
          starters: opponentMatchup.starters.map((playerId, index) => ({
            playerId,
            points: opponentMatchup.starters_points[index],
            ...getPlayerInfo(playerId)
          }))
        } : null,
        matchupId: myMatchup.matchup_id,
        isWinning: opponentMatchup ? myMatchup.points > opponentMatchup.points : null
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
      throw new Error(`Failed to get matchup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getCurrentWeek(): number {
    const now = new Date();
    const seasonStart = new Date('2024-09-05');
    const weeksSinceStart = Math.floor((now.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return Math.max(1, Math.min(18, weeksSinceStart + 1));
  }
}