"""Mission 00 checks. `make check 00` runs the replay; `make live 00` runs the live one."""

import pytest

from agent.testing import check_live, check_replay, load_target, replay_scenarios

mission = load_target(__file__)


@pytest.mark.parametrize("scenario", replay_scenarios(__file__))
async def test_replay(scenario):
    verdict = await check_replay(__file__, mission, scenario)
    if not verdict.passed:
        pytest.fail(verdict.report, pytrace=False)


@pytest.mark.live
async def test_live():
    verdict = await check_live(__file__, mission)
    if not verdict.passed:
        pytest.fail(verdict.report, pytrace=False)
