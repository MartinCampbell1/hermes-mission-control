import { GetSwarmSummary, LaunchSwarmMission } from '../../@types/workspace';
import { getWorkspaceSwarmSummary, launchWorkspaceSwarmMission } from '../../services/workspace/swarm';

export const getSwarm: GetSwarmSummary = async (_req, res, next) => {
  try {
    return res.json(getWorkspaceSwarmSummary());
  } catch (error) {
    return next(error);
  }
};

export const launchSwarmMission: LaunchSwarmMission = async (req, res, next) => {
  try {
    const result = launchWorkspaceSwarmMission(req.body ?? {});
    if (!result.ok) {
      const status = result.error === 'goal required' ? 400 : 502;
      return res.status(status).json(result);
    }
    return res.json(result);
  } catch (error) {
    return next(error);
  }
};
