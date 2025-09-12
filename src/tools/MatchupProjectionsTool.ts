import { config, getLeagueConfig } from "../config.js";
import type { SleeperMatchup, SleeperRoster, SleeperUser } from "../types/sleeper.js";

export class MatchupProjectionsTool {
  name = "get_matchup_projections";
  description = "Compare projected scores for your current matchup";
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
    const season = new Date().getFullYear().toString();

    try {
      // Fetch matchup data
      const [matchupsResponse, rostersResponse, usersResponse, playersResponse] = await Promise.all([
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/matchups/${week}`),
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/rosters`),
        fetch(`${config.api.baseUrl}/league/${leagueConfig.id}/users`),
        fetch(`${config.api.baseUrl}/players/nfl`)
      ]);

      if (!matchupsResponse.ok || !rostersResponse.ok || !usersResponse.ok || !playersResponse.ok) {
        throw new Error('Failed to fetch matchup projection data');
      }

      const matchups: SleeperMatchup[] = await matchupsResponse.json();
      const rosters: SleeperRoster[] = await rostersResponse.json();
      const users: SleeperUser[] = await usersResponse.json();
      const players = await playersResponse.json();

      const userMap = new Map(users.map(user => [user.user_id, user]));
      const rosterMap = new Map(rosters.map(roster => [roster.roster_id, roster]));

      // Find user's roster and matchup
      const myRoster = rosters.find(roster => {
        const user = userMap.get(roster.owner_id);
        return user?.display_name === config.username || 
               user?.username === config.username ||
               user?.display_name === leagueConfig.teamName || 
               user?.username === leagueConfig.teamName;
      });

      if (!myRoster) {
        throw new Error(`Could not find roster for user: ${config.username}`);
      }

      const myMatchup = matchups.find(m => m.roster_id === myRoster.roster_id);
      if (!myMatchup) {
        throw new Error(`No matchup found for week ${week}`);
      }

      const opponentMatchup = matchups.find(m => 
        m.matchup_id === myMatchup.matchup_id && m.roster_id !== myRoster.roster_id
      );

      const getTeamProjections = async (roster: SleeperRoster, starters: string[]) => {
        // Fetch individual projections for each starter
        const projectionPromises = starters.map(async (playerId: string) => {
          try {
            const projectionResponse = await fetch(
              `https://api.sleeper.app/projections/nfl/player/${playerId}?season=${season}&season_type=regular&week=${week}`
            );
            if (projectionResponse.ok) {
              return await projectionResponse.json();
            }
            return null;
          } catch (error) {
            console.warn(`Failed to fetch projection for player ${playerId}:`, error);
            return null;
          }
        });

        const projectionResults = await Promise.all(projectionPromises);

        const projectedStarters = starters.map((playerId, index) => {
          const player = players[playerId];
          const projectionData = projectionResults[index];
          
          if (!player) return null;
          
          const projectionStats = projectionData?.stats || {};
          const projectedPoints = projectionStats.pts_ppr || 0;

          return {
            playerId,
            name: `${player.first_name} ${player.last_name}`,
            position: player.position,
            team: player.team,
            projectedPoints: Number(projectedPoints.toFixed(1))
          };
        }).filter(Boolean);

        const totalProjected = projectedStarters.reduce((sum, p: any) => sum + p.projectedPoints, 0);
        
        return {
          starters: projectedStarters,
          totalProjected: totalProjected.toFixed(1)
        };
      };

      const getTeamName = (rosterId: number) => {
        const roster = rosterMap.get(rosterId);
        if (roster) {
          const user = userMap.get(roster.owner_id);
          return user?.display_name || user?.username || 'Unknown Team';
        }
        return 'Unknown Team';
      };

      const myProjections = await getTeamProjections(myRoster, myMatchup.starters);
      const opponentProjections = opponentMatchup ? 
        await getTeamProjections(rosterMap.get(opponentMatchup.roster_id)!, opponentMatchup.starters) : null;

      const result = {
        week,
        season,
        league: args.league || config.defaultLeague,
        matchupId: myMatchup.matchup_id,
        
        myTeam: {
          name: leagueConfig.teamName,
          rosterId: myMatchup.roster_id,
          actualPoints: myMatchup.points,
          projectedPoints: myProjections.totalProjected,
          starters: myProjections.starters
        },
        
        opponent: opponentMatchup && opponentProjections ? {
          name: getTeamName(opponentMatchup.roster_id),
          rosterId: opponentMatchup.roster_id,
          actualPoints: opponentMatchup.points,
          projectedPoints: opponentProjections.totalProjected,
          starters: opponentProjections.starters
        } : null,

        analysis: opponentProjections ? {
          projectedDifference: (parseFloat(myProjections.totalProjected) - parseFloat(opponentProjections.totalProjected)).toFixed(1),
          projectedWinner: parseFloat(myProjections.totalProjected) > parseFloat(opponentProjections.totalProjected) ? 
            leagueConfig.teamName : getTeamName(opponentMatchup!.roster_id),
          confidence: Math.abs(parseFloat(myProjections.totalProjected) - parseFloat(opponentProjections.totalProjected)) > 10 ? 
            'High' : Math.abs(parseFloat(myProjections.totalProjected) - parseFloat(opponentProjections.totalProjected)) > 5 ? 
            'Medium' : 'Low'
        } : null
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
      throw new Error(`Failed to get matchup projections: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getCurrentWeek(): number {
    const now = new Date();
    const seasonStart = new Date('2024-09-05');
    const weeksSinceStart = Math.floor((now.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return Math.max(1, Math.min(18, weeksSinceStart + 1));
  }
}