import * as dotenv from "dotenv";
import * as path from "path";
import * as os from "os";

dotenv.config({ path: path.join(os.homedir(), '.env') });
dotenv.config();

export const config = {
  username: process.env.SLEEPER_USERNAME || 'your_sleeper_username',
  leagues: {
    ROAD_TO_GLORY: {
      id: process.env.ROAD_TO_GLORY_ID || 'your_league_id_1',
      teamName: process.env.ROAD_TO_GLORY_TEAM || 'Your Team Name 1'
    },
    DYNASTY: {
      id: process.env.DYNASTY_LEAGUE_ID || 'your_league_id_2', 
      teamName: process.env.DYNASTY_TEAM || 'Your Team Name 2'
    }
  },
  defaultLeague: process.env.DEFAULT_LEAGUE || 'ROAD_TO_GLORY',
  api: {
    baseUrl: process.env.SLEEPER_API_BASE || 'https://api.sleeper.app/v1',
    cacheDuration: parseInt(process.env.CACHE_DURATION_MINUTES || '15') * 60 * 1000
  }
};

export function getLeagueConfig(leagueName?: string) {
  const league = leagueName || config.defaultLeague;
  return config.leagues[league as keyof typeof config.leagues];
}