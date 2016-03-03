﻿using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using NWheels.Processing;
using NWheels.Processing.Cqrs;

namespace NWheels.Stacks.UI.WpfCaliburnAvalon.CqrsApp
{
    public class CommandResult
    {
        private readonly Action<CommandResult> _onCompleted;

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        internal CommandResult(ICqrsCommand command, Action<CommandResult> onCompleted)
        {
            Command = command;
            _onCompleted = onCompleted;
        }

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        public ICqrsCommand Command { get; private set; }
        public ICommandCompletionEvent Completion { get; private set; }

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        internal void NotifyCompleted(ICommandCompletionEvent completionEvent)
        {
            this.Completion = completionEvent;

            if (_onCompleted != null)
            {
                _onCompleted(this);
            }
        }
    }
}
